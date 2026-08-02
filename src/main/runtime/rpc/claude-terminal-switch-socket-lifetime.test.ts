import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { readRuntimeMetadata } from '../runtime-metadata'
import { OrcaRuntimeRpcServer } from '../runtime-rpc'
import {
  attachClaudeTerminalAccountSwitchServices,
  resetClaudeTerminalAccountSwitchOperations
} from '../claude-terminal-account-switch-service'

/**
 * ORCA-168: the live switch never returned a result. `switchClaudeTerminal`
 * holds its response for the whole transaction (up to 180 s) but was not
 * classified as a long-poll, so no keepalive frame was ever written and the
 * server's own 30 s socket idle timer destroyed the connection — which the CLI
 * reports as "The Orca runtime closed the connection before responding", with
 * no operation id to poll. The idle timeout is not injectable, so the frames
 * themselves are the observable: a held switch must keep writing them.
 */
const KEEPALIVE_INTERVAL_MS = 60

type Harness = {
  server: OrcaRuntimeRpcServer
  endpoint: string
  authToken: string
}

const harnesses: Harness[] = []
const sockets: Socket[] = []

afterEach(async () => {
  while (sockets.length > 0) {
    sockets.pop()?.destroy()
  }
  while (harnesses.length > 0) {
    await harnesses.pop()?.server.stop()
  }
  attachClaudeTerminalAccountSwitchServices(null)
  resetClaudeTerminalAccountSwitchOperations()
})

/** A runtime whose stop step never completes, so the switch stays in flight. */
async function startRuntimeHoldingASwitch(): Promise<Harness> {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-switch-keepalive-'))
  const runtime = new OrcaRuntimeService()
  // Why never resolving: a real switch spends minutes here (the stop chord, the
  // relaunch, a 90 s verification budget). Stalling the runtime's first read is
  // the same hold without needing a live PTY, and it is the whole point — the
  // response must survive being held.
  Object.assign(runtime, {
    snapshotClaudeTerminalSwitchTarget: () => new Promise(() => {})
  })
  attachClaudeTerminalAccountSwitchServices({
    getSettings: () => ({
      claudeManagedAccounts: [
        {
          id: 'acct-target',
          email: 'target@example.com',
          authMethod: 'oauth',
          managedAuthPath: join(userDataPath, 'vault-target')
        }
      ] as never,
      terminalWindowsShell: null
    }),
    prepareClaudeAuth: async () => ({}) as never,
    getPtyClaudeAccountId: () => 'acct-source'
  })

  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath,
    keepaliveIntervalMs: KEEPALIVE_INTERVAL_MS
  })
  await server.start()
  const metadata = readRuntimeMetadata(userDataPath)
  const endpoint = metadata?.transports?.find((transport) => transport.kind === 'unix')?.endpoint
  if (!endpoint || !metadata?.authToken) {
    throw new Error('the runtime published no unix transport to connect to')
  }
  const harness: Harness = { server, endpoint, authToken: metadata.authToken }
  harnesses.push(harness)
  return harness
}

function collectFrames(harness: Harness, request: Record<string, unknown>): () => string[] {
  const socket = createConnection(harness.endpoint)
  sockets.push(socket)
  const frames: string[] = []
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        frames.push(line)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  })
  socket.on('connect', () => {
    socket.write(`${JSON.stringify({ ...request, authToken: harness.authToken })}\n`)
  })
  return () => frames
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for the runtime socket to produce frames')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('a held Claude terminal switch over the real runtime socket', () => {
  it('writes keepalive frames while the transaction is still running', async () => {
    const harness = await startRuntimeHoldingASwitch()

    const frames = collectFrames(harness, {
      id: 'req-switch-1',
      method: 'accounts.switchClaudeTerminal',
      params: { terminal: 'orca-terminal-1', targetAccountId: 'acct-target' }
    })

    await waitFor(() => frames().filter((line) => line.includes('_keepalive')).length >= 2)

    expect(frames().every((line) => line.includes('_keepalive'))).toBe(true)
  })

  it('writes no keepalive frames for an ordinary short request', async () => {
    const harness = await startRuntimeHoldingASwitch()

    const frames = collectFrames(harness, { id: 'req-status-1', method: 'status.get' })

    await waitFor(() => frames().length > 0)
    await new Promise((resolve) => setTimeout(resolve, KEEPALIVE_INTERVAL_MS * 3))

    expect(frames().some((line) => line.includes('_keepalive'))).toBe(false)
  })
})
