import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  createTeamPanelModelPoller,
  TEAM_READ_SUSTAINED_FAILURE_MS,
  type TeamPanelPollDeps
} from './team-panel-model-poll'
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
    readLeads: vi.fn(async () => ({ leads: [{ handle: 'term' }], restoring: [] })),
    findCaller: vi.fn(() => CALLER),
    readState: vi.fn(async () => ({ role: 'lead' }) as OrchestratorGameState),
    readQuestions: vi.fn(async () => []),
    readXp: vi.fn(async () => 350),
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
  it('hands the model the characters XP, and null when the host cannot list them', async () => {
    const read = deps()
    const poller = createTeamPanelModelPoller(read.all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    expect(read.all.modelOf).toHaveBeenLastCalledWith(expect.objectContaining({ xp: 350 }))
    release()

    const failing = deps({
      readXp: vi.fn(async () => {
        throw new Error('old host')
      })
    })
    const again = createTeamPanelModelPoller(failing.all, 20_000).subscribe(SCOPE)
    // Why twice: the rejected read settles through its own catch before the model is built.
    await flush()
    await flush()
    expect(failing.all.modelOf).toHaveBeenLastCalledWith(expect.objectContaining({ xp: null }))
    again()
  })

  // ORCA-1264: the state's team XP counts every reward the mod toasted, so the bar moves with them.
  it("hands the model the state's team XP and skips the characters read", async () => {
    const read = deps({
      readState: vi.fn(
        async () =>
          ({
            role: 'lead',
            teamXp: { total: 1530, recent: [] }
          }) as unknown as OrchestratorGameState
      )
    })
    const release = createTeamPanelModelPoller(read.all, 20_000).subscribe(SCOPE)
    await flush()
    expect(read.all.modelOf).toHaveBeenLastCalledWith(expect.objectContaining({ xp: 1530 }))
    expect(read.all.readXp).not.toHaveBeenCalled()
    release()
  })

  // ORCA-1329: Retry now asks the host to re-read its lists once, and settles when that read lands.
  it('makes only the next read fresh, settling Retry now when it lands', async () => {
    const { all } = deps()
    const poller = createTeamPanelModelPoller(all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    let settled = false
    const retry = poller.refreshFresh().then(() => (settled = true))
    expect(settled).toBe(false)
    await retry
    await vi.advanceTimersByTimeAsync(20_000)
    expect(vi.mocked(all.readState).mock.calls.map((call) => call[2])).toEqual([
      { fresh: false },
      { fresh: true },
      { fresh: false }
    ])
    release()
  })

  it('folds a tap during a read into one fresh read after it', async () => {
    let land = (): void => {}
    const readState = vi.fn<TeamPanelPollDeps['readState']>(
      () =>
        new Promise<OrchestratorGameState>(
          (done) => (land = () => done({ role: 'lead' } as OrchestratorGameState))
        )
    )
    const { all } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    let settled = false
    void poller.refreshFresh().then(() => (settled = true))
    land()
    await flush()
    await flush()
    expect(settled).toBe(false)
    expect(readState.mock.calls.map((call) => call[2])).toEqual([{ fresh: false }, { fresh: true }])
    land()
    await flush()
    await flush()
    expect(settled).toBe(true)
    release()
  })

  // Why: an older host strips `fresh` and answers from its cache; the tap must still end, error and all.
  it('settles Retry now on a host that ignores the flag, keeping the error it answered', async () => {
    const failed = { ...MODEL, prs: { kind: 'error', message: 'The provider did not answer.' } }
    const { all, last } = deps({ modelOf: vi.fn(() => failed as TeamPanelGameModel) })
    const poller = createTeamPanelModelPoller(all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    await poller.refreshFresh()
    expect(last()).toMatchObject({ kind: 'ready', value: { prs: { kind: 'error' } } })
    release()
  })

  it('settles Retry now when its run ends before the read', async () => {
    const readState = vi.fn(() => new Promise<OrchestratorGameState>(() => {}))
    const poller = createTeamPanelModelPoller(deps({ readState }).all, 20_000)
    const release = poller.subscribe(SCOPE)
    const retry = poller.refreshFresh()
    release()
    await expect(retry).resolves.toBeUndefined()
  })

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

  // Why: the sidebar holds the run for its rows; opening the panel must still read fresh, as before it did.
  it('re-reads from loading when the panel joins a run only the sidebar holds', async () => {
    let finish: (state: OrchestratorGameState) => void = () => {}
    const readState = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ role: 'lead' })
    const { all, sources, last } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    poller.subscribe(SCOPE, { background: true })
    await flush()
    const before = sources.length

    const releasePanel = poller.subscribe(SCOPE)
    expect(sources[before]?.section).toEqual({ kind: 'loading' })
    await flush()
    expect(readState).toHaveBeenCalledTimes(2)
    expect(last()).toEqual({ kind: 'ready', value: MODEL })

    // The sidebar's read, still in flight when the panel opened, publishes nothing.
    const published = sources.length
    finish({ role: 'lead' } as OrchestratorGameState)
    await flush()
    expect(sources.length).toBe(published)

    // The sidebar joining an open panel adds no read, and the sidebar alone keeps polling.
    poller.subscribe(SCOPE, { background: true })
    await flush()
    expect(readState).toHaveBeenCalledTimes(2)
    releasePanel()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(readState).toHaveBeenCalledTimes(3)
  })

  it('says unavailable when no live lead runs in the project, without reading game.state', async () => {
    const { all, last } = deps({ findCaller: vi.fn(() => null) })

    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    expect(last()).toEqual({ kind: 'unavailable' })
    expect(all.readState).not.toHaveBeenCalled()
  })

  // Why (ORCA-1130): the no-team form while the lead's pane comes back says the team is gone.
  it('stays loading while the host restores the lead, and reads again soon', async () => {
    const findCaller = vi.fn().mockReturnValueOnce('restoring').mockReturnValue(CALLER)
    const { all, sources, last } = deps({ findCaller })

    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()
    expect(last()).toEqual({ kind: 'loading' })
    expect(all.readState).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(last()).toEqual({ kind: 'ready', value: MODEL })
    expect(sources.some((one) => one.section.kind === 'unavailable')).toBe(false)
  })

  // Why (ORCA-1199): a confirmed last team made the scene replay every join on the next read.
  it('marks the last team it shows while the host restores the lead as updating', async () => {
    const findCaller = vi.fn().mockReturnValueOnce(CALLER).mockReturnValue('restoring')
    const { all, sources } = deps({ findCaller })
    const poller = createTeamPanelModelPoller(all, 20_000)
    poller.subscribe(SCOPE)
    await flush()
    poller.refresh()
    await flush()

    expect(sources.at(-1)).toEqual({
      section: { kind: 'ready', value: MODEL },
      retry: null,
      updating: true
    })
  })

  it('keeps the last team quietly, with no retry, when one later read fails', async () => {
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
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(last()).toEqual({ kind: 'ready', value: MODEL })
    expect(sources.at(-1)?.retry).toBeNull()
    expect(sources.at(-1)?.updating).toBeFalsy()
  })

  it('offers the retry only once reads have failed for the sustained window', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ role: 'lead' })
    const { all, sources, last } = deps({ readState })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    // Failures at 20, 40 and 60 s: the streak is 40 s old, short of the window.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })

    // The failure at 80 s is TEAM_READ_SUSTAINED_FAILURE_MS after the first.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(TEAM_READ_SUSTAINED_FAILURE_MS).toBe(60_000)
    expect(last()).toEqual({ kind: 'ready', value: MODEL })
    expect(sources.at(-1)?.retry).toEqual(expect.any(Function))
    expect(sources.at(-1)?.updating).toBeFalsy()

    sources.at(-1)?.retry?.()
    await flush()
    expect(sources.at(-1)?.retry).toBeNull()
    expect(sources.at(-1)?.updating).toBeFalsy()
  })

  // Why time, not a count: answers and Jev lines call refresh in bursts, which would trip a count in seconds.
  it('does not count a burst of failed refreshes as a sustained failure', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValue(new Error('timeout'))
    const { all, sources } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    poller.subscribe(SCOPE)
    await flush()

    for (let index = 0; index < 6; index += 1) {
      poller.refresh()
      await flush()
      await flush()
    }

    expect(readState.mock.calls.length).toBeGreaterThan(3)
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })
  })

  it('starts a new streak after a read succeeds', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ role: 'lead' })
    const { all, sources } = deps({ readState })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    // Failures at 20, 40, 100 and 120 s span 100 s, but a success at 60 s splits them.
    await vi.advanceTimersByTimeAsync(100_000)
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })
  })

  // Why: a streak nobody polled through is not a sustained failure; one miss on return is still brief.
  it('starts a new streak when the project comes back after a pause in reads', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValue(new Error('timeout'))
    const { all, sources } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })
    release()

    const other = poller.subscribe({ ...SCOPE, key: 'local|repo-2', repoId: 'repo-2' })
    await vi.advanceTimersByTimeAsync(100_000)
    other()

    poller.subscribe(SCOPE)
    await flush()
    await flush()
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })
  })

  it('records the failure class when a streak starts, turns sustained, and recovers', async () => {
    const record = vi.fn()
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('Runtime request timed out before game.state completed'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ role: 'lead' })
    const { all } = deps({ readState, record })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    await vi.advanceTimersByTimeAsync(20_000)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenLastCalledWith('team_panel_read_failed', {
      stage: 'game.state',
      failure: 'timeout',
      sustained: false
    })

    await vi.advanceTimersByTimeAsync(40_000)
    expect(record).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(20_000)
    expect(record).toHaveBeenLastCalledWith('team_panel_read_failed', {
      stage: 'game.state',
      failure: 'error',
      sustained: true
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(record).toHaveBeenLastCalledWith('team_panel_read_recovered', { failedForMs: 80_000 })
    expect(record).toHaveBeenCalledTimes(3)
  })

  it('names the leads read when game.leads is the one that fails', async () => {
    const record = vi.fn()
    const readLeads = vi
      .fn()
      .mockResolvedValueOnce({ leads: [{ handle: 'term' }], restoring: [] })
      .mockRejectedValue(new Error('host down'))
    const { all } = deps({ readLeads, record })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    await vi.advanceTimersByTimeAsync(20_000)
    expect(record).toHaveBeenLastCalledWith('team_panel_read_failed', {
      stage: 'game.leads',
      failure: 'error',
      sustained: false
    })
  })

  // Why: leaving the panel ends the run, and a sick host must not cost the team on the way back.
  // Why: reopening the panel showed the loader until a fresh read landed, up to 16 s (ORCA-1199).
  it('shows the last team as updating, not loading, when the panel reopens or joins', async () => {
    let finish: (state: OrchestratorGameState) => void = () => {}
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const { all, sources } = deps({ readState })
    const poller = createTeamPanelModelPoller(all, 20_000)
    const release = poller.subscribe(SCOPE)
    await flush()
    release()

    const before = sources.length
    poller.subscribe(SCOPE)
    expect(sources[before]).toEqual({
      section: { kind: 'ready', value: MODEL },
      retry: null,
      updating: true
    })

    const joined = sources.length
    poller.subscribe(SCOPE, { background: true })
    const releasePanel = poller.subscribe(SCOPE)
    releasePanel()
    poller.subscribe(SCOPE)
    expect(sources.slice(joined).map((source) => source.section.kind)).not.toContain('loading')

    await flush()
    finish({ role: 'lead' } as OrchestratorGameState)
    await flush()
    expect(sources.at(-1)).toEqual({ section: { kind: 'ready', value: MODEL }, retry: null })
  })

  // Why: the panel first draws what the sidebar's run published, and its scene measured joins from it.
  it('marks a read only the sidebar holds as updating, and the panel’s own read as fresh', async () => {
    const { all, sources } = deps()
    const poller = createTeamPanelModelPoller(all, 20_000)
    poller.subscribe(SCOPE, { background: true })
    await flush()
    expect(sources.at(-1)).toEqual({
      section: { kind: 'ready', value: MODEL },
      retry: null,
      updating: true
    })

    poller.subscribe(SCOPE)
    await flush()
    expect(sources.at(-1)).toEqual({ section: { kind: 'ready', value: MODEL }, retry: null })
  })

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
    expect(sources.at(-1)).toMatchObject({ retry: null, updating: true })
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
