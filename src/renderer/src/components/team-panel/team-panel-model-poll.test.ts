import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { createTeamPanelModelPoller, type TeamPanelPollDeps } from './team-panel-model-poll'
import type { TeamPanelModelSource } from './use-team-panel-model'

const CALLER = { worktreeId: 'wt', terminalHandle: 'term', paneKey: 'pane' }
const MODEL = { kind: 'team', projectName: 'orca-oss' } as unknown as TeamPanelGameModel
const SCOPE = {
  key: 'local|repo-1',
  target: { kind: 'local' as const },
  repoId: 'repo-1',
  projectName: 'orca-oss',
  worktreeIds: new Set(['wt'])
}

function deps(overrides: Partial<TeamPanelPollDeps> = {}) {
  const sources: TeamPanelModelSource[] = []
  const all: TeamPanelPollDeps = {
    readLeads: vi.fn(async () => [{ handle: 'term' }]),
    findCaller: vi.fn(() => CALLER),
    readState: vi.fn(async () => ({ role: 'lead' }) as OrchestratorGameState),
    readQuestions: vi.fn(async () => []),
    modelOf: vi.fn(() => MODEL),
    publish: (source) => sources.push(source),
    ...overrides
  }
  return { all, sources, last: () => sources.at(-1)?.section }
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createTeamPanelModelPoller', () => {
  it('reads once for every subscriber of the same project and stops when the last leaves', async () => {
    const { all, last } = deps()
    const poller = createTeamPanelModelPoller(all, 20_000)

    const releaseBar = poller.subscribe(SCOPE)
    const releasePanel = poller.subscribe(SCOPE)
    await flush()
    expect(all.readState).toHaveBeenCalledTimes(1)
    expect(last()).toEqual({ kind: 'ready', value: MODEL })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(all.readState).toHaveBeenCalledTimes(2)

    releaseBar()
    releasePanel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(all.readState).toHaveBeenCalledTimes(2)
  })

  it('says unavailable when no live lead runs in the project, without reading game.state', async () => {
    const { all, last } = deps({ findCaller: vi.fn(() => null) })

    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    expect(last()).toEqual({ kind: 'unavailable' })
    expect(all.readState).not.toHaveBeenCalled()
  })

  it('keeps the last team and offers a retry when a later read fails', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ role: 'lead' })
    const { all, sources, last } = deps({ readState })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()
    expect(sources.at(-1)?.retry).toBeNull()

    await vi.advanceTimersByTimeAsync(20_000)

    expect(last()).toEqual({ kind: 'ready', value: MODEL })
    expect(sources.at(-1)?.retry).toEqual(expect.any(Function))
    sources.at(-1)?.retry?.()
    await flush()
    expect(last()).toEqual({ kind: 'ready', value: MODEL })
    expect(sources.at(-1)?.retry).toBeNull()
  })

  // Why: leaving the panel ends the run, and a sick host must not cost the team on the way back.
  it('keeps the team when the first read after reopening the panel fails', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValue(new Error('timeout'))
    const { all, sources, last } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    release()

    poller.subscribe(SCOPE)
    await flush()

    expect(last()).toEqual({ kind: 'ready', value: MODEL })
    expect(sources.at(-1)?.retry).toEqual(expect.any(Function))
  })

  it('forgets the team once the host says there is no lead', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValue(new Error('timeout'))
    const findCaller = vi
      .fn()
      .mockReturnValueOnce(CALLER)
      .mockReturnValueOnce(null)
      .mockReturnValue(CALLER)
    const { all, last } = deps({ readState, findCaller })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    await vi.advanceTimersByTimeAsync(20_000)
    expect(last()).toEqual({ kind: 'unavailable' })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(last()).toEqual({ kind: 'error', message: 'timeout' })
  })

  // Why: a host older than game.leads has no game at all, which is no team, not a failed read.
  it('says unavailable when the host has no game methods', async () => {
    const readLeads = vi.fn().mockRejectedValue(
      new RuntimeRpcCallError({
        id: 'one',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method: game.leads' },
        _meta: { runtimeId: 'host' }
      })
    )
    const { all, sources, last } = deps({ readLeads })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    expect(last()).toEqual({ kind: 'unavailable' })
    expect(sources.at(-1)?.retry).toBeNull()
  })

  it('reports a failed leads read as an error, not as no team', async () => {
    const { all, last } = deps({ readLeads: vi.fn().mockRejectedValue(new Error('host down')) })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    expect(last()).toEqual({ kind: 'error', message: 'host down' })
  })

  it('reports the error when the first read fails, and retries on demand', async () => {
    const readState = vi
      .fn()
      .mockRejectedValueOnce(new Error('host down'))
      .mockResolvedValue({ role: 'lead' })
    const { all, sources, last } = deps({ readState })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    expect(last()).toEqual({ kind: 'error', message: 'host down' })
    sources.at(-1)?.retry?.()
    await flush()
    expect(last()).toEqual({ kind: 'ready', value: MODEL })
  })

  it('switches to the new project and drops the old one', async () => {
    const { all } = deps()
    const poller = createTeamPanelModelPoller(all, 20_000)
    const releaseOld = poller.subscribe(SCOPE)
    await flush()

    poller.subscribe({ ...SCOPE, key: 'local|repo-2', repoId: 'repo-2' })
    releaseOld()
    await flush()

    expect(vi.mocked(all.modelOf).mock.calls.at(-1)?.[0]).toMatchObject({ repoId: 'repo-2' })
  })

  // Why coalesce: an answer pushes a change signal per host, and each must not stack a game.state read.
  it('re-reads on demand, folding a burst into one read after the one in flight', async () => {
    let finish: (state: OrchestratorGameState) => void = () => {}
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ role: 'lead' })
    const { all } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    poller.refresh()
    expect(all.readLeads).not.toHaveBeenCalled()

    poller.subscribe(SCOPE)
    await flush()
    poller.refresh()
    await flush()
    expect(readState).toHaveBeenCalledTimes(2)

    poller.refresh()
    poller.refresh()
    await flush()
    expect(readState).toHaveBeenCalledTimes(2)

    finish({ role: 'lead' } as OrchestratorGameState)
    await flush()
    await flush()
    expect(readState).toHaveBeenCalledTimes(3)
  })
})
