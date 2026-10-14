// Why: runs the built `orca events` against a real in-process runtime over the local
// socket, so the CLI transport, the streaming RPC and the event sources are proven
// together, the way a script consuming the stream sees them.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { waitFor } from './runtime-rpc-test-harness'
import type { AgentStatusEventSource } from '../plugins/plugin-agent-status-event'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const CLI_PATH = join(process.cwd(), 'out', 'cli', 'index.js')
const describeIfBuilt = existsSync(CLI_PATH) ? describe : describe.skip

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup()
  }
})

function spawnEvents(userDataPath: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_USER_DATA_PATH: userDataPath }
  // Why: a developer shell paired to a remote host must not redirect this local probe.
  delete env.ORCA_PAIRING_CODE
  delete env.ORCA_REMOTE_PAIRING
  delete env.ORCA_ENVIRONMENT
  const child = spawn(process.execPath, [CLI_PATH, 'events', ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams
  const lines: string[] = []
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    lines.push(...parts.filter((line) => line.length > 0))
  })
  cleanups.push(() => {
    child.kill()
  })
  return { child, lines }
}

describeIfBuilt('orca events subprocess', () => {
  it('prints ready, then one JSON line per event, and frees the subscription on exit', async () => {
    const listeners = new Set<(event: AgentStatusEventSource) => void>()
    const runtime = new OrcaRuntimeService(null, undefined, {
      subscribeAgentStatusEvents: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    })
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-events-cli-'))
    const server = new OrcaRuntimeRpcServer({ runtime, userDataPath })
    await server.start()
    cleanups.push(() => server.stop())

    const { child, lines } = spawnEvents(userDataPath, ['--event', 'agent.*', '--json'])
    await waitFor(() => lines.includes('{"ready":true}'), 10_000)
    expect(listeners.size).toBe(1)

    listeners.forEach((listener) =>
      listener({
        worktreeId: 'wt-1',
        paneKey: 'tab:leaf',
        receivedAt: 1_700_000_000_000,
        payload: { state: 'done', agentType: 'claude' }
      })
    )
    await waitFor(() => lines.length >= 2, 10_000)

    expect(JSON.parse(lines[1]!)).toEqual({
      name: 'agent.status.changed',
      at: 1_700_000_000_000,
      worktreeId: 'wt-1',
      terminal: null,
      payload: { paneKey: 'tab:leaf', state: 'done', agentType: 'claude' }
    })

    child.kill()
    await waitFor(() => listeners.size === 0, 10_000)
  }, 30_000)

  it('rejects an unknown event name without connecting', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-events-cli-'))
    const { child, lines } = spawnEvents(userDataPath, ['--event', 'agent.done', '--json'])
    const exitCode = await new Promise<number>((resolve) =>
      child.once('close', (code) => resolve(code ?? 1))
    )
    // Why stdout: with --json the CLI reports failures as a JSON envelope there.
    expect(exitCode).not.toBe(0)
    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: expect.stringContaining('agent.status.changed') }
    })
  }, 30_000)
})
