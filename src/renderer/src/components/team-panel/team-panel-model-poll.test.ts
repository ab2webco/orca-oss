import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
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

  it('keeps the last team when a later read fails', async () => {
    const readState = vi
      .fn()
      .mockResolvedValueOnce({ role: 'lead' })
      .mockRejectedValueOnce(new Error('timeout'))
    const { all, last } = deps({ readState })
    createTeamPanelModelPoller(all, 20_000).subscribe(SCOPE)
    await flush()

    await vi.advanceTimersByTimeAsync(20_000)

    expect(last()).toEqual({ kind: 'ready', value: MODEL })
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
})
