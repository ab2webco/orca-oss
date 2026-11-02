import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { readRuntimeMetadata } from '../runtime-metadata'
import { OrcaRuntimeRpcServer } from '../runtime-rpc'

// Why: terminal.wake waits up to 30 s for the pane to start, the socket's own idle
// cap, so without keepalive frames the CLI saw "closed the connection" (ORCA-915).
const KEEPALIVE_INTERVAL_MS = 60

const servers: OrcaRuntimeRpcServer[] = []
const sockets: Socket[] = []

afterEach(async () => {
  while (sockets.length > 0) {
    sockets.pop()?.destroy()
  }
  while (servers.length > 0) {
    await servers.pop()?.stop()
  }
})

async function startRuntimeHoldingAWake(): Promise<{ endpoint: string; authToken: string }> {
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-wake-keepalive-'))
  const runtime = new OrcaRuntimeService()
  const held = (): Promise<never> => new Promise(() => {})
  Object.assign(runtime, { wakeTerminal: held, wakeGameMember: held })
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath,
    keepaliveIntervalMs: KEEPALIVE_INTERVAL_MS
  })
  await server.start()
  servers.push(server)
  const metadata = readRuntimeMetadata(userDataPath)
  const endpoint = metadata?.transports?.find((transport) => transport.kind === 'unix')?.endpoint
  if (!endpoint || !metadata?.authToken) {
    throw new Error('the runtime published no unix transport to connect to')
  }
  return { endpoint, authToken: metadata.authToken }
}

function collectFrames(
  target: { endpoint: string; authToken: string },
  request: Record<string, unknown>
): () => string[] {
  const socket = createConnection(target.endpoint)
  sockets.push(socket)
  const frames: string[] = []
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    frames.push(...lines.filter((line) => line.trim()))
  })
  socket.on('connect', () => {
    socket.write(`${JSON.stringify({ ...request, authToken: target.authToken })}\n`)
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

describe('a held terminal wake over the real runtime socket', () => {
  it.each([
    ['terminal.wake', { terminal: 'term_asleep' }],
    ['game.memberWake', { dispatchId: 'ctx_remote' }]
  ])('%s writes keepalive frames while the pane is still starting', async (method, params) => {
    const target = await startRuntimeHoldingAWake()

    const frames = collectFrames(target, { id: 'req-wake-1', method, params })

    await waitFor(() => frames().filter((line) => line.includes('_keepalive')).length >= 2)
    expect(frames().every((line) => line.includes('_keepalive'))).toBe(true)
  })
})
