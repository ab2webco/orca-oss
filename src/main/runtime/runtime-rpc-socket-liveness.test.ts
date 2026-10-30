import { mkdtempSync, rmSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findTransport, type RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { OrcaRuntimeService } from './orca-runtime'
import { readRuntimeMetadata } from './runtime-metadata'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

// Why: the same frame `orca status` sends; null when the runtime answers, else what the CLI would have seen.
function statusError(
  metadata: RuntimeMetadata,
  socket = createConnection(findTransport(metadata, 'unix')!.endpoint)
): Promise<string | null> {
  return new Promise((resolve) => {
    let buffer = ''
    const settle = (result: string | null): void => {
      clearTimeout(timer)
      socket.removeAllListeners()
      if (result !== null) {
        socket.destroy()
      }
      resolve(result)
    }
    const timer = setTimeout(() => settle('timeout'), 2000)
    socket.setEncoding('utf8')
    socket.once('error', (error: NodeJS.ErrnoException) => settle(error.code ?? error.message))
    socket.once('close', () => settle('closed'))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.includes('\n')) {
        settle((JSON.parse(buffer.split('\n')[0]) as { ok: boolean }).ok ? null : 'rpc_error')
      }
    })
    const send = (): void => {
      socket.write(
        `${JSON.stringify({ id: 'status', authToken: metadata.authToken, method: 'status.get' })}\n`
      )
    }
    if (socket.connecting) {
      socket.once('connect', send)
    } else {
      send()
    }
  })
}

// Why: the connection failures the CLI reports as runtime_unavailable ("Could not connect").
const UNREACHABLE = expect.stringMatching(/^(ENOENT|ECONNREFUSED|ECONNRESET|EPIPE|closed)$/)

async function openIdleConnections(endpoint: string, count: number): Promise<Socket[]> {
  const sockets = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<Socket>((resolve, reject) => {
          const socket = createConnection(endpoint, () => resolve(socket))
          socket.once('error', reject)
        })
    )
  )
  // Why: let main's accept loop register every holder before the next client dials.
  await new Promise((resolve) => setTimeout(resolve, 50))
  return sockets
}

// Why: named pipes leave no file to delete.
describe.skipIf(process.platform === 'win32')('local RPC socket liveness (ORCA-830)', () => {
  const cleanups: (() => Promise<void> | void)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup()
    }
    vi.restoreAllMocks()
  })

  async function startServer(): Promise<{
    server: OrcaRuntimeRpcServer
    metadata: RuntimeMetadata
  }> {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-830-'))
    const server = new OrcaRuntimeRpcServer({ runtime: new OrcaRuntimeService(), userDataPath })
    await server.start()
    cleanups.push(() => rmSync(userDataPath, { recursive: true, force: true }))
    cleanups.push(() => server.stop())
    const metadata = readRuntimeMetadata(userDataPath)
    if (!metadata) {
      throw new Error('start() must publish runtime metadata')
    }
    return { server, metadata }
  }

  it('rebinds a socket file deleted under a live runtime without cutting held connections', async () => {
    const { server, metadata } = await startServer()
    const endpoint = findTransport(metadata, 'unix')!.endpoint
    const [held] = await openIdleConnections(endpoint, 1)
    cleanups.push(() => {
      held.destroy()
    })

    rmSync(endpoint)
    expect(await statusError(metadata)).toEqual(UNREACHABLE)

    await server.checkRuntimeSocketLiveness()

    expect(await statusError(metadata)).toBeNull()
    expect(await statusError(metadata, held)).toBeNull()
    expect(readRuntimeMetadata(server['userDataPath'])).toEqual(metadata)
  })

  it('still answers with every fenced long-poll and stream slot held plus a burst', async () => {
    const { server, metadata } = await startServer()
    const endpoint = findTransport(metadata, 'unix')!.endpoint
    // Why: 16 long-polls + 8 streams, plus 18 short calls from a lead and 8 members firing at once.
    const holders = await openIdleConnections(endpoint, 16 + 8 + 18)
    cleanups.push(() => holders.forEach((socket) => socket.destroy()))

    expect(await statusError(metadata)).toBeNull()
    await server.checkRuntimeSocketLiveness()
    expect(holders.every((socket) => !socket.destroyed)).toBe(true)
  })

  it('stops probing once the server stops', async () => {
    const { server } = await startServer()
    const watch = server['socketLivenessWatch']
    if (!watch) {
      throw new Error('start() must arm the socket liveness watch')
    }
    const watchStop = vi.spyOn(watch, 'stop')
    await server.stop()

    expect(watchStop).toHaveBeenCalledTimes(1)
    expect(server['socketLivenessWatch']).toBeNull()
  })
})
