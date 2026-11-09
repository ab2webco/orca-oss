import { describe, expect, it } from 'vitest'
import { GAME_LEAD_ACTIONS } from './orchestrator-game-lead-actions'
import type { GameAction } from './orchestrator-game-actions'
import type { GameAgent, OrchestratorGameState } from './orchestrator-game-state'
import { teamActionsOf, teamDockActionsOf } from './team-panel-actions'

const member = (paneKey: string, overrides: Partial<GameAgent> = {}): GameAgent => ({
  paneKey,
  displayName: paneKey,
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: `term_${paneKey}`,
  ...overrides
})

const merged = {
  review: {
    provider: 'github' as const,
    number: 41,
    title: 'x',
    url: 'https://github.com/o/r/pull/41',
    state: 'merged' as const,
    ci: 'success' as const
  }
}

const PROJECT: GameAction[] = [
  { id: 'action-0', label: 'Deploy', icon: 'ship', pin: true, prompt: 'Deploy to staging.' },
  { id: 'action-1', label: 'Board', command: 'board', mcp: { server: 'plane', tool: 'list' } },
  { id: 'action-2', label: 'Runs', mcp: { server: 'tests', tool: 'list' } }
]

const stateOf = (overrides: Partial<OrchestratorGameState> = {}): OrchestratorGameState =>
  ({
    role: 'lead',
    stopped: null,
    lead: { cap: 4 },
    agents: [member('a'), member('b'), member('done', merged)],
    project: {
      reviews: null,
      todo: {
        provider: 'jira',
        total: 3,
        url: null,
        items: ['T-1', 'T-2', 'T-3'].map((id) => ({ id, title: id, url: '', group: 'todo' }))
      }
    },
    actions: [...GAME_LEAD_ACTIONS, ...PROJECT],
    ...overrides
  }) as unknown as OrchestratorGameState

const byId = (state: OrchestratorGameState) =>
  Object.fromEntries(teamActionsOf(state).map((one) => [one.id, one]))

describe('teamActionsOf', () => {
  it("counts Orca's actions from the fleet: To Do with free slots, stopped and finished members", () => {
    const actions = byId(stateOf())
    expect(actions['lead:wave']).toMatchObject({ orca: 'wave', icon: 'launch', now: { count: 2 } })
    expect(actions['lead:push']).toMatchObject({ orca: 'push', now: { count: 2 }, off: null })
    expect(actions['lead:sweep']).toMatchObject({ orca: 'sweep', now: { count: 1 } })
    expect(actions['lead:status']).toMatchObject({ now: null, off: null })
    expect(actions['lead:stop']).toMatchObject({ now: null, off: null })
    expect(actions['lead:wave']?.send).toBe((GAME_LEAD_ACTIONS[0] as { prompt: string }).prompt)
  })

  it('says why one does not apply, and hides wave and sweep but not push during a STOP', () => {
    const idle = byId(stateOf({ agents: [], project: undefined }))
    expect(idle['lead:wave']).toMatchObject({ now: null, off: 'nothingToDo' })
    expect(idle['lead:push']).toMatchObject({ now: null, off: 'nobodyStopped' })
    expect(idle['lead:sweep']).toMatchObject({ now: null, off: 'nothingToClose' })

    const stopped = byId(stateOf({ stopped: { since: null, by: null } as never }))
    expect(stopped['lead:wave']).toMatchObject({ now: null, off: 'stopped' })
    expect(stopped['lead:sweep']).toMatchObject({ now: null, off: 'stopped' })
    expect(stopped['lead:push']).toMatchObject({ now: { count: 2 } })
    expect(stopped['lead:stop']).toMatchObject({ off: 'alreadyStopped' })
  })

  it("sends a project prompt as written, an MCP action as its slash command, or says it can't", () => {
    const actions = byId(stateOf())
    expect(actions['action-0']).toMatchObject({
      orca: null,
      label: 'Deploy',
      icon: 'ship',
      pin: true,
      send: 'Deploy to staging.',
      off: null
    })
    expect(actions['action-1']).toMatchObject({
      icon: null,
      pin: false,
      command: 'board',
      send: '/board',
      off: null
    })
    expect(actions['action-0']?.command).toBeNull()
    expect(actions['lead:wave']?.command).toBe('wave')
    expect(actions['action-2']).toMatchObject({ send: null, off: 'noNativePath' })
  })

  it("draws an older host's lead actions with their default icons", () => {
    const old = GAME_LEAD_ACTIONS.map(({ icon: _icon, ...rest }) => rest)
    expect(byId(stateOf({ actions: old }))['lead:sweep']?.icon).toBe('check')
  })
})

describe('teamDockActionsOf', () => {
  it('puts what applies now first, then the pinned project actions with a new one first; never stop', () => {
    const actions = teamActionsOf(
      stateOf({
        actions: [
          ...GAME_LEAD_ACTIONS,
          { id: 'action-0', label: 'A', pin: true, prompt: 'a' },
          { id: 'action-1', label: 'B', pin: true, prompt: 'b' },
          { id: 'action-2', label: 'C', prompt: 'c' }
        ]
      })
    )
    expect(teamDockActionsOf(actions, null).map((one) => one.id)).toEqual([
      'lead:wave',
      'lead:push',
      'lead:sweep',
      'action-0',
      'action-1'
    ])
    expect(
      teamDockActionsOf(actions, 'action-1')
        .map((one) => one.id)
        .slice(3)
    ).toEqual(['action-1', 'action-0'])
  })
})
