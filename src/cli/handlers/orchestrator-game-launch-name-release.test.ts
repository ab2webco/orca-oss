import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'

const released = (calls: [string, unknown][]): unknown[] =>
  calls.filter(([method]) => method === 'game.memberNameRelease').map(([, params]) => params)

// A workerStart that throws `error`, over the shared fake client.
const startThrowing = (error: Error) => {
  const { client, calls } = fakeClient(stateWith())
  const failing = {
    call: (method: string, params: unknown) => {
      if (method === 'orchestration.workerStart') {
        calls.push([method, params])
        return Promise.reject(error)
      }
      return client.call(method as never, params as never)
    }
  } as unknown as RuntimeClient
  return { client: failing, calls }
}

describe('orca game launch gives a failed launch its name back (ORCA-1034)', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('keeps the name of a launch that started', async () => {
    const { client, calls } = fakeClient(stateWith())
    await launch(client, 'CIN-12')
    expect(released(calls)).toEqual([])
  })

  it('releases it when the host reports the start failed', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': {
        runId: 'run_1',
        taskId: 'task_1',
        dispatchId: 'dispatch_1',
        state: 'failed',
        effects: [],
        residualResources: []
      }
    })
    await launch(client, 'CIN-12')
    expect(released(calls)).toEqual([expect.objectContaining({ ticket: 'CIN-12' })])
  })

  it('releases it when the host refuses the start', async () => {
    const { client, calls } = startThrowing(new RuntimeClientError('invalid_argument', 'no'))
    await expect(launch(client, 'CIN-12')).rejects.toThrow('no')
    expect(released(calls)).toHaveLength(1)
  })

  it('keeps it when the host may have run the start', async () => {
    const { client, calls } = startThrowing(new RuntimeClientError('runtime_timeout', 'late'))
    await expect(launch(client, 'CIN-12')).rejects.toThrow('late')
    expect(released(calls)).toEqual([])
  })
})
