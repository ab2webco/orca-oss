import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'

const FAILED_START = {
  runId: 'run_1',
  taskId: 'task_1',
  dispatchId: 'dispatch_1',
  state: 'failed',
  lastError: 'Claude never became ready',
  effects: [{ kind: 'worktree', id: 'repo-on-host::/w/cin-12' }],
  residualResources: []
}

const ON_IMAC: [string, string][] = [
  ['on', 'imac'],
  ['repo', 'name:cineco']
]

describe('orca game launch that fails to start (ORCA-1103)', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
    delete process.env.ORCA_GAME_LOCALE
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  const events = (calls: [string, unknown][]) =>
    calls.filter(([method]) => method === 'game.eventPost').map(([, params]) => params)

  // Three failed launches on m1 left two worktrees named after the ticket and no failure on record.
  it('releases a failed start on a paired host, so the worktree it created goes, and records the failure', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': FAILED_START,
      'orchestration.workerRelease': {
        dispatchId: 'dispatch_1',
        state: 'released',
        remote: { closedTerminals: [], removedWorktree: 'repo-on-host::/w/cin-12' }
      }
    })

    await launch(client, 'CIN-12', ON_IMAC)

    expect(calls).toContainEqual(['orchestration.workerRelease', { dispatch: 'dispatch_1' }])
    expect(events(calls)).toEqual([
      expect.objectContaining({
        kind: 'failed',
        ticket: 'CIN-12',
        text: expect.stringContaining('Claude never became ready')
      })
    ])
    expect(JSON.parse(output.join('')).result.lastError).toContain(
      'Removed the worktree it created on imac.'
    )
    expect(process.exitCode).toBe(1)
  })

  it('says so when the host keeps the worktree, never that it is gone', async () => {
    const { client } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': FAILED_START,
      'orchestration.workerRelease': {
        dispatchId: 'dispatch_1',
        state: 'released',
        remote: { closedTerminals: [], removedWorktree: null, worktreeError: 'has changes' }
      }
    })

    await launch(client, 'CIN-12', ON_IMAC)

    const lastError = JSON.parse(output.join('')).result.lastError as string
    expect(lastError).toContain('Its worktree on imac was kept: has changes')
    expect(lastError).not.toContain('Removed')
  })

  it('reports a release that failed instead of hiding it', async () => {
    const { client } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': FAILED_START
    })
    client.call = (async (method: string, params: unknown) => {
      if (method === 'orchestration.workerRelease') {
        throw new Error('host unreachable')
      }
      return fakeClient(stateWith(), undefined, {
        'orchestration.workerStart': FAILED_START
      }).client.call(method, params as never)
    }) as typeof client.call

    await launch(client, 'CIN-12', ON_IMAC)

    expect(JSON.parse(output.join('')).result.lastError).toContain(
      'Its worktree on imac may remain: host unreachable'
    )
  })

  it('records a failed local start as failed, not claimed, and releases nothing', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': { ...FAILED_START, effects: [] }
    })

    await launch(client, 'CIN-12')

    expect(calls.map(([method]) => method)).not.toContain('orchestration.workerRelease')
    expect(events(calls)).toEqual([expect.objectContaining({ kind: 'failed', ticket: 'CIN-12' })])
  })

  it('still records a started member as claimed', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-12', ON_IMAC)

    expect(calls.map(([method]) => method)).not.toContain('orchestration.workerRelease')
    expect(events(calls)).toEqual([expect.objectContaining({ kind: 'claimed', ticket: 'CIN-12' })])
  })
})
