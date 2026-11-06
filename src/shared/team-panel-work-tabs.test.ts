import { describe, expect, it } from 'vitest'
import type { GameGitHubBudget } from './orchestrator-game-github-budget'
import type { GameHostCapacity } from './orchestrator-game-host-capacity'
import type { GameProjectItem, GameProjectList } from './orchestrator-game-project-work'
import type { OrchestratorGameState } from './orchestrator-game-state'
import { teamMachinesSectionOf, teamPrSectionOf } from './team-panel-work-tabs'
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
      state: stateOf({ project: { reviews: null, todo: null }, githubBudget: budget(0) }),
      members: [],
      isFolder: false,
      texts,
      now: NOW
    })

    expect(section).toEqual({ kind: 'error', message: 'Limit, 12 min' })
  })

  it('names no provider when the list failed for another reason', () => {
    const section = teamPrSectionOf({
      state: stateOf({ project: { reviews: null, todo: null }, githubBudget: budget(3000) }),
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

  it('is unavailable from an older host that sends neither', () => {
    expect(teamMachinesSectionOf({ state: stateOf({}), members: [] })).toEqual({
      kind: 'unavailable'
    })
  })

  it('hides the tab when the project turned it off', () => {
    const state = stateOf({ hostCapacity: [ok()] })
    state.panel = { tabs: { machines: false } } as OrchestratorGameState['panel']

    expect(teamMachinesSectionOf({ state, members: [] })).toBeNull()
  })
})
