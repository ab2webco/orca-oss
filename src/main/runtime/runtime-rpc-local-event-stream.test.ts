import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { readRuntimeMetadata } from './runtime-metadata'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { waitFor } from './runtime-rpc-test-harness'
import type { AgentStatusEventSource } from '../plugins/plugin-agent-status-event'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

type Frame = Record<string, unknown>

function openStream(endpoint: string, request: Frame): { socket: Socket; frames: Frame[] } {
  const frames: Frame[] = []
  const socket = createConnection(endpoint)
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('error', () => {})
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const raw = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (raw) {
        frames.push(JSON.parse(raw) as Frame)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  })
  socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
  return { socket, frames }
}

const servers: OrcaRuntimeRpcServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
})

async function startServer() {
  const listeners = new Set<(event: AgentStatusEventSource) => void>()
  const runtime = new OrcaRuntimeService(null, undefined, {
    subscribeAgentStatusEvents: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  })
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
  const server = new OrcaRuntimeRpcServer({ runtime, userDataPath, keepaliveIntervalMs: 50 })
  servers.push(server)
  await server.start()
  const metadata = readRuntimeMetadata(userDataPath)!
  return { endpoint: metadata.transports[0]!.endpoint, authToken: metadata.authToken, listeners }
}

describe('events.subscribe over the local socket', () => {
  it('streams frames on one request and releases the subscription when the client leaves', async () => {
    const { endpoint, authToken, listeners } = await startServer()
    const { socket, frames } = openStream(endpoint, {
      id: 'req_events',
      authToken,
      method: 'events.subscribe',
      params: { names: ['agent.*'] }
    })

    await waitFor(() => frames.some((frame) => (frame.result as Frame)?.type === 'ready'))
    listeners.forEach((listener) =>
      listener({ paneKey: 'tab:leaf', receivedAt: 7, payload: { state: 'working' } })
    )
    await waitFor(() => frames.some((frame) => (frame.result as Frame)?.type === 'event'))

    expect(frames.find((frame) => (frame.result as Frame)?.type === 'event')).toMatchObject({
      id: 'req_events',
      ok: true,
      streaming: true,
      result: { type: 'event', event: { name: 'agent.status.changed', at: 7 } }
    })
    expect(listeners.size).toBe(1)

    socket.destroy()
    await waitFor(() => listeners.size === 0)
  })

  it('caps concurrent streams so they cannot take every socket connection', async () => {
    const { endpoint, authToken } = await startServer()
    const subscribe = (id: string) =>
      openStream(endpoint, { id, authToken, method: 'events.subscribe', params: {} })
    const isReady = (frames: Frame[]) =>
      frames.some((frame) => (frame.result as Frame)?.type === 'ready')
    const open = Array.from({ length: 8 }, (_, index) => subscribe(`req_${index}`))
    await waitFor(() => open.every(({ frames }) => isReady(frames)))

    const overflow = subscribe('req_overflow')
    await waitFor(() => overflow.frames.some((frame) => frame.ok !== undefined))
    expect(overflow.frames[0]).toMatchObject({ ok: false, error: { code: 'runtime_busy' } })

    open[0]!.socket.destroy()
    const retry = subscribe('req_retry')
    await waitFor(() => isReady(retry.frames))
    for (const { socket } of [...open, retry]) {
      socket.destroy()
    }
  })

  it('keeps refusing streaming methods built for paired WebSocket clients', async () => {
    const { endpoint, authToken } = await startServer()
    const { frames } = openStream(endpoint, {
      id: 'req_notifications',
      authToken,
      method: 'notifications.subscribe'
    })
    await waitFor(() => frames.some((frame) => frame.ok !== undefined))
    expect(frames[0]).toMatchObject({ ok: false, error: { code: 'method_not_supported' } })
  })

  it('answers an invalid subscription with one error instead of an open stream', async () => {
    const { endpoint, authToken } = await startServer()
    const { frames } = openStream(endpoint, {
      id: 'req_bad',
      authToken,
      method: 'events.subscribe',
      params: { names: ['agent.done'] }
    })
    await waitFor(() => frames.some((frame) => frame.ok !== undefined))
    expect(frames.filter((frame) => frame.ok !== undefined)).toEqual([
      expect.objectContaining({
        id: 'req_bad',
        ok: false,
        error: expect.objectContaining({ code: 'invalid_argument' })
      })
    ])
  })
})
