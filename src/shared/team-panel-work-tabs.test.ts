import { describe, expect, it } from 'vitest'
import type { GameGitHubBudget } from './orchestrator-game-github-budget'
import type { GameHostCapacity } from './orchestrator-game-host-capacity'
import type {
  GameProjectItem,
  GameProjectList,
  GameProjectQueue,
  GameQueueEntry
} from './orchestrator-game-project-work'
import type { OrchestratorGameState } from './orchestrator-game-state'
import { teamMachinesSectionOf, teamPrSectionOf, teamQueueSectionOf } from './team-panel-work-tabs'
import type { TeamHost, TeamMemberCard } from './team-panel-model-types'

const GB = 1024 ** 3
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0)
const texts = {
  providerFailed: 'The provider did not answer.',
  githubLimit: (minutes: number) => `Limit, ${minutes} min`
}

const stateOf = (over: Partial<OrchestratorGameState>): OrchestratorGameState =>
  ({ config: {}, ...over }) as OrchestratorGameState

const pr = (id: string, over: Partial<GameProjectItem> = {}): GameProjectItem => ({
  id,
  title: `PR ${id}`,
  url: `https://example.test/${id.slice(1)}`,
  ...over
})

const list = (items: GameProjectItem[], over: Partial<GameProjectList> = {}): GameProjectList => ({
  provider: 'github',
  total: items.length,
  url: 'https://example.test/pulls',
  items,
  ...over
})

const budget = (remaining: number): GameGitHubBudget => {
  const bucket = { limit: 5000, remaining, resetAt: NOW / 1000 + 720, orcaCalls: 0 }
  return { graphql: bucket, core: bucket, top: [], low: remaining < 1000 }
}

const member = (url: string, paneKey: string, host: TeamHost = { kind: 'local' }) =>
  ({ paneKey, host, pr: { url } }) as unknown as TeamMemberCard

describe('teamPrSectionOf', () => {
  const ready = (state: OrchestratorGameState, members: TeamMemberCard[] = []) => {
    const section = teamPrSectionOf({ state, members, isFolder: false, texts, now: NOW })
    if (section?.kind !== 'ready') {
      throw new Error(`expected ready, got ${section?.kind}`)
    }
    return section.value
  }

  it('names each PR by what stops it, the most urgent first', () => {
    const items = [
      pr('#1', { status: 'success' }),
      pr('#2', { status: 'pending' }),
      pr('#3', { status: 'failure' }),
      pr('#4', { status: 'success', reviewBlock: 'conflict' }),
      pr('#5', { status: 'success', reviewBlock: 'draft' })
    ]
    const { rows } = ready(stateOf({ project: { reviews: list(items), todo: null } }))

    expect(rows.map((row) => [row.label, row.reason, row.status])).toEqual([
      ['#3', 'checksFailed', 'attention'],
      ['#4', 'conflict', 'risk'],
      ['#2', 'inReview', 'working'],
      ['#1', 'ready', 'done'],
      ['#5', 'draft', 'idle']
    ])
  })

  it('keeps a failed check above a conflict on the same PR', () => {
    const items = [pr('#1', { status: 'failure', reviewBlock: 'conflict' })]
    const { rows } = ready(stateOf({ project: { reviews: list(items), todo: null } }))

    expect(rows[0].reason).toBe('checksFailed')
  })

  it('never reads an unknown CI as passing', () => {
    const items = [pr('!7'), pr('#8', { status: 'none' }), pr('#9', { status: 'neutral' })]
    const { rows } = ready(
      stateOf({ project: { reviews: list(items, { provider: 'gitlab' }), todo: null } })
    )

    expect(rows.map((row) => [row.label, row.reason, row.status])).toEqual([
      ['!7', 'checksUnknown', 'idle'],
      ['#8', 'checksUnknown', 'idle'],
      ['#9', 'checksUnknown', 'idle']
    ])
  })

  it('degrades on an older host that sends no block', () => {
    const items = [pr('#1', { status: 'success' })]
    const { rows } = ready(stateOf({ project: { reviews: list(items), todo: null } }))

    expect(rows[0]).toMatchObject({ number: 1, reason: 'ready' })
  })

  it('keeps the host total and its list link when it cut the rows', () => {
    const value = ready(
      stateOf({ project: { reviews: list([pr('#1')], { total: 12 }), todo: null } })
    )

    expect(value).toMatchObject({ total: 12, listUrl: 'https://example.test/pulls' })
    expect(value.rows).toHaveLength(1)
  })

  it('carries the action the project says the list runs', () => {
    const value = ready(
      stateOf({
        project: { reviews: list([pr('#1')], { actionId: 'action-0' }), todo: null },
        actions: [{ id: 'action-0', label: 'Review', prompt: 'Review my PRs' }]
      })
    )

    expect(value.listAction).toEqual({ id: 'action-0', label: 'Review', prompt: 'Review my PRs' })
  })

  it('ties a row to the member working on it by URL', () => {
    const items = [pr('#1'), pr('#2')]
    const { rows } = ready(stateOf({ project: { reviews: list(items), todo: null } }), [
      member('https://example.test/2', 'pane-2')
    ])

    expect(rows.map((row) => row.memberKey)).toEqual([null, 'pane-2'])
  })

  it('is unavailable from a host that sends no project work', () => {
    const section = teamPrSectionOf({
      state: stateOf({}),
      members: [],
      isFolder: false,
      texts,
      now: NOW
    })

    expect(section).toEqual({ kind: 'unavailable' })
  })

  it('says the GitHub limit when the list failed with the budget spent', () => {
    const section = teamPrSectionOf({
      state: stateOf({
        project: { reviews: null, todo: null, reviewsFailedOn: 'github' },
        githubBudget: budget(0)
      }),
      members: [],
      isFolder: false,
      texts,
      now: NOW
    })

    expect(section).toEqual({
      kind: 'error',
      message: 'Limit, 12 min',
      provider: 'GitHub',
      limited: true
    })
  })

  it('names GitHub, with no limit, when a GitHub list failed for another reason', () => {
    const section = teamPrSectionOf({
      state: stateOf({
        project: { reviews: null, todo: null, reviewsFailedOn: 'github' },
        githubBudget: budget(3000)
      }),
      members: [],
      isFolder: false,
      texts,
      now: NOW
    })

    expect(section).toEqual({
      kind: 'error',
      message: 'The provider did not answer.',
      provider: 'GitHub'
    })
  })

  // Review M2: the budget is host-wide; another project spending it says nothing about a GitLab repo.
  it('never blames GitHub, nor hides Retry, for a list the host did not read on GitHub', () => {
    const section = teamPrSectionOf({
      state: stateOf({ project: { reviews: null, todo: null }, githubBudget: budget(0) }),
      members: [],
      isFolder: false,
      texts,
      now: NOW
    })

    expect(section).toEqual({ kind: 'error', message: 'The provider did not answer.' })
  })

  it('hides the tab in a folder workspace, which has no remote', () => {
    const section = teamPrSectionOf({
      state: stateOf({ project: { reviews: null, todo: null } }),
      members: [],
      isFolder: true,
      texts,
      now: NOW
    })

    expect(section).toBeNull()
  })

  it('hides the tab when the project turned it off', () => {
    const state = stateOf({ project: { reviews: list([pr('#1')]), todo: null } })
    state.panel = { tabs: { prs: false } } as OrchestratorGameState['panel']

    expect(teamPrSectionOf({ state, members: [], isFolder: false, texts, now: NOW })).toBeNull()
  })
})

describe('teamQueueSectionOf', () => {
  const entry = (over: Partial<GameQueueEntry> = {}): GameQueueEntry => ({
    id: '#1',
    title: 'PR 1',
    url: 'https://example.test/1',
    position: 1,
    state: 'waiting',
    since: NOW - 60_000,
    ...over
  })
  const section = (queue: GameProjectQueue | undefined, members: TeamMemberCard[] = []) =>
    teamQueueSectionOf({
      state: stateOf({ project: { reviews: null, todo: null, ...(queue ? { queue } : {}) } }),
      members,
      isFolder: false,
      texts,
      now: NOW
    })

  it('colours each entry by what it is doing', () => {
    const result = section({
      provider: 'github',
      entries: [
        entry({ id: '#1', state: 'checks' }),
        entry({ id: '#2', state: 'waiting' }),
        entry({ id: '#3', state: 'failed' })
      ]
    })

    expect(result).toMatchObject({
      kind: 'ready',
      value: [
        { label: '#1', state: 'checks', status: 'working' },
        { label: '#2', state: 'waiting', status: 'idle' },
        { label: '#3', state: 'failed', status: 'attention' }
      ]
    })
  })

  it('turns a long wait amber, and keeps a failure red', () => {
    const long = NOW - 2 * 60 * 60_000
    const result = section({
      provider: 'github',
      entries: [
        entry({ id: '#1', since: long }),
        entry({ id: '#2', since: long, state: 'failed' }),
        entry({ id: '#3', since: null })
      ]
    })

    expect(result).toMatchObject({
      value: [{ status: 'risk' }, { status: 'attention' }, { status: 'idle' }]
    })
  })

  it('ties an entry to its member by URL', () => {
    const result = section({ provider: 'github', entries: [entry()] }, [
      member('https://example.test/1', 'pane-1')
    ])

    expect(result).toMatchObject({ value: [{ memberKey: 'pane-1' }] })
  })

  it('reads an empty queue as empty', () => {
    expect(section({ provider: 'github', entries: [] })).toEqual({ kind: 'ready', value: [] })
  })

  it('reads no queue as unavailable, never as empty', () => {
    expect(section(undefined)).toEqual({ kind: 'unavailable' })
  })

  it('reports a failed read as an error', () => {
    expect(section({ provider: 'github', entries: null })).toEqual({
      kind: 'error',
      message: 'The provider did not answer.',
      provider: 'GitHub'
    })
  })

  it('hides the tab in a folder workspace', () => {
    const result = teamQueueSectionOf({
      state: stateOf({}),
      members: [],
      isFolder: true,
      texts,
      now: NOW
    })

    expect(result).toBeNull()
  })

  it('ignores a Queue toggle an old host still publishes (ORCA-1112)', () => {
    const state = stateOf({})
    state.panel = { tabs: { queue: false } } as unknown as OrchestratorGameState['panel']

    expect(teamQueueSectionOf({ state, members: [], isFolder: false, texts, now: NOW })).toEqual({
      kind: 'unavailable'
    })
  })
})

describe('teamMachinesSectionOf', () => {
  const ok = (over: Partial<GameHostCapacity> = {}): GameHostCapacity =>
    ({
      host: 'local',
      running: 0,
      cap: 4,
      status: 'ok',
      cpuCoreCount: 8,
      totalMemory: 32 * GB,
      availableMemory: 20 * GB,
      loadAverage1m: 2,
      ...over
    }) as GameHostCapacity

  const machines = (hostCapacity: GameHostCapacity[], members: TeamMemberCard[] = []) => {
    const section = teamMachinesSectionOf({ state: stateOf({ hostCapacity }), members })
    if (section?.kind !== 'ready') {
      throw new Error(`expected ready, got ${section?.kind}`)
    }
    return section.value
  }

  it('reads a free host as idle and a busy one as working', () => {
    const rows = machines([ok(), ok({ host: 'm1', running: 3, cap: 5 })])

    expect(rows.map((row) => [row.host.kind, row.running, row.cap, row.status])).toEqual([
      ['local', 0, 4, 'idle'],
      ['remote', 3, 5, 'working']
    ])
  })

  it('warns on the same low memory `game fleet` warns on, over being busy', () => {
    const rows = machines([ok({ running: 2, availableMemory: 3 * GB })])

    expect(rows[0].status).toBe('risk')
  })

  it('carries the CPU use and workspaces disk a newer host reports', () => {
    const rows = machines([
      ok({ cpuUsagePercent: 37, workspaceDiskTotal: 900 * GB, workspaceDiskFree: 400 * GB })
    ])

    expect(rows[0].reading).toMatchObject({
      kind: 'ok',
      cpuUsagePercent: 37,
      workspaceDiskTotal: 900 * GB,
      workspaceDiskFree: 400 * GB
    })
  })

  it('carries no CPU use or disk for an older host, so neither reads as zero', () => {
    const rows = machines([ok()])

    expect(rows[0].reading).not.toHaveProperty('cpuUsagePercent')
    expect(rows[0].reading).not.toHaveProperty('workspaceDiskFree')
  })

  it('reads an unreachable host as red, with no figures', () => {
    const rows = machines([{ host: 'm1', running: 1, status: 'unreachable' }])

    expect(rows[0]).toMatchObject({
      status: 'attention',
      cap: null,
      reading: { kind: 'unreachable', lastSeenAt: null },
      host: { kind: 'remote', name: 'm1', environmentId: null, reachable: false }
    })
  })

  it('takes the environment id from a member on that host', () => {
    const host: TeamHost = { kind: 'remote', name: 'm1', environmentId: 'env-1', reachable: true }
    const rows = machines([ok({ host: 'm1' })], [member('https://example.test/1', 'pane', host)])

    expect(rows[0].host).toEqual(host)
  })

  it('is empty for a lead on this machine alone', () => {
    const state = stateOf({ hosts: [{ host: 'local', cap: 4, status: 'ok' }] })

    expect(teamMachinesSectionOf({ state, members: [] })).toEqual({ kind: 'ready', value: [] })
  })

  it('lists this machine alone for a lead with no saved host', () => {
    const state = stateOf({ localHost: ok({ running: 2 }) })

    expect(teamMachinesSectionOf({ state, members: [] })).toMatchObject({
      kind: 'ready',
      value: [{ host: { kind: 'local' }, running: 2, status: 'working', reading: { kind: 'ok' } }]
    })
  })

  it('is unavailable from an older host that sends neither', () => {
    expect(teamMachinesSectionOf({ state: stateOf({}), members: [] })).toEqual({
      kind: 'unavailable'
    })
  })

  describe('launch eligibility (ORCA-1207)', () => {
    const repo = { id: 'h', displayName: 'orca-oss', path: '/w', remoteKey: null }
    const refusal = 'orca-oss on m1 names github.com/stablyai/orca, the upstream every fork shares.'

    it("reads a host without the project's repo as not registered, never free", () => {
      const [, koombea] = machines([
        ok(),
        ok({
          host: 'koombea',
          launch: { kind: 'unregistered', project: 'orca-oss', reason: 'not on koombea' }
        })
      ])
      expect(koombea).toMatchObject({
        status: 'closed',
        launch: { kind: 'unregistered', project: 'orca-oss', reason: 'not on koombea' }
      })
    })

    it('carries the refusal of a host the repo-scope check refuses', () => {
      const [m1] = machines([ok({ host: 'm1', launch: { kind: 'refused', reason: refusal } })])
      expect(m1).toMatchObject({ status: 'closed', launch: { kind: 'refused', reason: refusal } })
    })

    it('keeps a ready host idle, with its free slots', () => {
      const [m1] = machines([ok({ host: 'm1', cap: 5, launch: { kind: 'ready', repo } })])
      expect(m1).toMatchObject({ status: 'idle', running: 0, cap: 5, launch: { kind: 'ready' } })
      expect(m1.launch).not.toHaveProperty('repo')
    })

    it("reads a paired host an older Orca's state says nothing about as unknown; this machine as ready", () => {
      const [local, m1] = machines([ok(), ok({ host: 'm1' })])
      expect(local.launch).toEqual({ kind: 'ready' })
      expect(m1.launch).toEqual({ kind: 'unknown' })
    })

    it('reads a kind a newer host publishes as unknown', () => {
      const launch = { kind: 'quarantined' } as unknown as GameHostCapacity['launch']
      expect(machines([ok({ host: 'm1', launch })])[0].launch).toEqual({ kind: 'unknown' })
    })

    it('reads a silent repo list as attention, and members already there as working', () => {
      const rows = machines([
        ok({ host: 'imac', launch: { kind: 'unanswered' } }),
        ok({ host: 'm1', running: 2, launch: { kind: 'refused', reason: refusal } })
      ])
      expect(rows.map((one) => one.status)).toEqual(['attention', 'working'])
    })
  })

  it('hides the tab when the project turned it off', () => {
    const state = stateOf({ hostCapacity: [ok()] })
    state.panel = { tabs: { machines: false } } as OrchestratorGameState['panel']

    expect(teamMachinesSectionOf({ state, members: [] })).toBeNull()
  })
})
