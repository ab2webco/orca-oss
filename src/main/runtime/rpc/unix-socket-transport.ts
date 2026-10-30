// Why: this is the original Unix socket / named pipe transport extracted from
// runtime-rpc.ts. It preserves the exact same behavior: newline-delimited JSON,
// 30s idle timeout, 1MB max message, 32 max connections, chmod 0o600 on Unix.
// It also owns the keepalive timer and per-connection abort signal so the
// server-side handler can cancel long-poll dispatches when the client goes
// away. See design doc §3.1.
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { chmodSync, existsSync, rmSync } from 'node:fs'
import type { LocalStreamWrite, RpcMessageContext, RpcTransport } from './transport'

const MAX_RUNTIME_RPC_MESSAGE_BYTES = 1024 * 1024
const RUNTIME_RPC_SOCKET_IDLE_TIMEOUT_MS = 30_000
const MAX_RUNTIME_RPC_CONNECTIONS = 32
const DEFAULT_KEEPALIVE_INTERVAL_MS = 10_000
const MAX_LOCAL_STREAM_BACKLOG_BYTES = 1024 * 1024
// Why: answered by the transport itself, so a liveness probe exercises accept/read/write without auth or the dispatcher.
export const RUNTIME_RPC_PROBE_FRAME = '{"_probe":true}'

export type UnixSocketTransportDiagnostics = {
  activeConnections: number
  droppedConnections: number
  lastServerError: string | null
}

export type UnixSocketTransportOptions = {
  endpoint: string
  kind: 'unix' | 'named-pipe'
  // Why: how often to write `{"_keepalive":true}\n` frames while a dispatch
  // is pending. Each write resets both the server-side idle timer and, once
  // the client honours them, the client-side idle timer. Tests override this
  // to avoid waiting 10 s for a frame.
  keepaliveIntervalMs?: number
}

type MessageHandler = (
  msg: string,
  reply: (response: string) => void,
  context?: RpcMessageContext
) => void

export class UnixSocketTransport implements RpcTransport {
  private readonly endpoint: string
  private readonly kind: 'unix' | 'named-pipe'
  private readonly keepaliveIntervalMs: number
  private server: Server | null = null
  private messageHandler: MessageHandler | null = null
  private readonly activeSockets = new Set<Socket>()
  private droppedConnections = 0
  private lastServerError: string | null = null

  constructor({ endpoint, kind, keepaliveIntervalMs }: UnixSocketTransportOptions) {
    this.endpoint = endpoint
    this.kind = kind
    this.keepaliveIntervalMs = keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  async start(): Promise<void> {
    if (this.server) {
      return
    }

    if (this.kind === 'unix' && existsSync(this.endpoint)) {
      rmSync(this.endpoint, { force: true })
    }

    const server = createServer((socket) => {
      this.handleConnection(socket)
    })
    server.maxConnections = MAX_RUNTIME_RPC_CONNECTIONS

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.endpoint, () => {
        server.off('error', reject)
        resolve()
      })
    })
    // Why: past maxConnections Node closes new clients silently; the CLI reads that as "could not connect" (ORCA-830).
    server.on('drop', () => {
      this.droppedConnections += 1
    })
    // Why: an accept error (EMFILE under load) would otherwise throw in main with no listener attached.
    server.on('error', (error) => {
      this.lastServerError = error instanceof Error ? error.message : String(error)
      console.error('[runtime] Local RPC transport error:', error)
    })

    if (this.kind === 'unix') {
      chmodSync(this.endpoint, 0o600)
    }

    this.server = server
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) {
      return
    }
    const closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    // Why: server.close() stops accepting new connections but waits for
    // existing sockets; long-poll keepalives can otherwise hold shutdown open.
    for (const socket of Array.from(this.activeSockets)) {
      socket.destroy()
    }
    await closePromise
    if (this.kind === 'unix' && existsSync(this.endpoint)) {
      rmSync(this.endpoint, { force: true })
    }
  }

  // Why: stop() unlinks the endpoint, so a rebind recreates a socket file something else deleted.
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  getDiagnostics(): UnixSocketTransportDiagnostics {
    return {
      activeConnections: this.activeSockets.size,
      droppedConnections: this.droppedConnections,
      lastServerError: this.lastServerError
    }
  }

  /** Dials this transport's own endpoint like a CLI would; resolves null when it answers, else the reason. */
  probe(timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false
      let buffer = ''
      const socket = createConnection(this.endpoint)
      const settle = (failure: string | null): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolve(failure)
      }
      const timer = setTimeout(() => settle(`no answer within ${timeoutMs}ms`), timeoutMs)
      socket.setEncoding('utf8')
      socket.once('error', (error: NodeJS.ErrnoException) => settle(error.code ?? error.message))
      socket.once('close', () => settle('closed before answering'))
      socket.on('data', (chunk: string) => {
        buffer += chunk
        if (buffer.includes(`${RUNTIME_RPC_PROBE_FRAME}\n`)) {
          settle(null)
        }
      })
      socket.write(`${RUNTIME_RPC_PROBE_FRAME}\n`)
    })
  }

  private handleConnection(socket: Socket): void {
    this.activeSockets.add(socket)
    let buffer = ''
    let oversized = false
    // Why: each in-flight dispatch registers its own AbortController here so
    // `socket.on('close')` can abort them all at once. Keeping the set scoped
    // to the connection (rather than a single shared controller) means
    // completing one dispatch does not abort any other dispatch still running
    // on the same socket — future-proofing for a persistent CLI socket that
    // multiplexes sequential requests.
    const inflight = new Set<() => void>()

    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    socket.setTimeout(RUNTIME_RPC_SOCKET_IDLE_TIMEOUT_MS, () => {
      socket.destroy()
    })
    socket.on('error', () => {
      socket.destroy()
    })
    socket.once('close', () => {
      for (const cleanup of inflight) {
        cleanup()
      }
      inflight.clear()
      this.activeSockets.delete(socket)
    })
    socket.on('data', (chunk: string) => {
      if (oversized) {
        return
      }
      buffer += chunk
      // Why: the Orca runtime lives in Electron main, so it must reject
      // oversized local RPC frames instead of letting a local client grow an
      // unbounded buffer and stall the app.
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RUNTIME_RPC_MESSAGE_BYTES) {
        oversized = true
        this.messageHandler?.('', (response) => {
          socket.write(`${response}\n`)
          socket.end()
        })
        return
      }
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const rawMessage = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (rawMessage === RUNTIME_RPC_PROBE_FRAME) {
          socket.end(`${RUNTIME_RPC_PROBE_FRAME}\n`)
        } else if (rawMessage) {
          this.dispatchMessage(socket, rawMessage, inflight)
        }
        newlineIndex = buffer.indexOf('\n')
      }
    })
  }

  // Why: the keepalive timer is opt-in per request via `startKeepalive()`.
  // Short RPCs never call it and pay no timer overhead; only long-poll
  // handlers (e.g. orchestration.check --wait) arm it. See §3.1.
  private dispatchMessage(socket: Socket, rawMessage: string, inflight: Set<() => void>): void {
    let replied = false
    let keepaliveTimer: NodeJS.Timeout | null = null
    // Why: each dispatch needs its own abort signal and keepalive timer
    // cleanup. Socket close runs every cleanup without touching sibling
    // dispatches that already replied on the same connection.
    const abortController = new AbortController()
    let cleanedUp = false
    const cleanupDispatch = (abort: boolean): void => {
      if (cleanedUp) {
        return
      }
      cleanedUp = true
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer)
        keepaliveTimer = null
      }
      if (abort) {
        abortController.abort()
      }
      inflight.delete(abortDispatch)
    }
    const abortDispatch = (): void => cleanupDispatch(true)
    inflight.add(abortDispatch)

    const reply = (response: string): void => {
      if (replied) {
        return
      }
      replied = true
      cleanupDispatch(false)
      if (!socket.destroyed && socket.writable) {
        socket.write(`${response}\n`)
      }
    }

    const sendFrame = (response: string): LocalStreamWrite => {
      if (replied || socket.destroyed || !socket.writable) {
        return 'closed'
      }
      // Why: a reader that stopped draining must not grow main's write buffer without bound.
      if (socket.writableLength > MAX_LOCAL_STREAM_BACKLOG_BYTES) {
        return 'dropped'
      }
      socket.write(`${response}\n`)
      return 'written'
    }

    const startKeepalive = (): void => {
      if (keepaliveTimer || replied) {
        return
      }
      keepaliveTimer = setInterval(() => {
        if (replied || socket.destroyed || !socket.writable) {
          cleanupDispatch(socket.destroyed || !socket.writable)
          return
        }
        socket.write('{"_keepalive":true}\n')
      }, this.keepaliveIntervalMs)
      // Why: don't hold the process open solely on the keepalive interval.
      if (typeof keepaliveTimer.unref === 'function') {
        keepaliveTimer.unref()
      }
    }

    this.messageHandler?.(rawMessage, reply, {
      signal: abortController.signal,
      startKeepalive,
      sendFrame
    })
  }
}
