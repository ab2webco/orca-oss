import { describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'

const STATE = {
  config: { mode: 'zen', scene: 'quest', hud: true, rewards: false, tracker: true },
  sources: { mode: 'project' },
  warnings: ['orchestratorGame.extra is not a known setting'],
  worktree: { id: 'wt-1', path: '/w/orca', branch: 'feat/x', displayName: 'orca' },
  agents: [
    {
      paneKey: 'tab-1:leaf-1',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: true
    },
    {
      paneKey: 'tab-1:leaf-2',
      displayName: 'tester',
      agentType: 'claude',
      state: 'waiting',
      toolName: null,
      isLeader: false
    }
  ],
  review: {
    provider: 'github',
    number: 42,
    title: 'feat: game',
    url: 'https://github.com/o/r/pull/42',
    state: 'open',
    ci: 'failure'
  },
  workItem: {
    provider: 'plane',
    identifier: 'ORCA-580',
    title: 'Game',
    url: 'https://plane.example/ORCA-580',
    status: 'In Progress',
    statusGroup: 'in_progress'
  }
}

describe('parseGameState', () => {
  it('reads a bare object and keeps only the fields the plugin uses', () => {
    const parsed = parseGameState(JSON.stringify(STATE))
    expect(parsed?.config).toEqual({ mode: 'zen', scene: 'quest', hud: true, rewards: false })
    expect(parsed?.warnings).toEqual(['orchestratorGame.extra is not a known setting'])
    expect(parsed?.worktree).toEqual(STATE.worktree)
    expect(parsed?.agents.map((agent) => agent.displayName)).toEqual(['lead', 'tester'])
    expect(parsed?.review).toEqual(STATE.review)
    expect(parsed?.workItem).toEqual(STATE.workItem)
  })

  it('unwraps the CLI result envelope', () => {
    const parsed = parseGameState(JSON.stringify({ id: 'x', ok: true, result: STATE }))
    expect(parsed?.agents).toHaveLength(2)
    expect(parsed?.review?.number).toBe(42)
  })

  it('drops agents with a bad shape and keeps the rest', () => {
    const agents = [
      ...STATE.agents,
      { paneKey: 'p', displayName: 'x', agentType: 'claude', state: 'sleeping', isLeader: false },
      { paneKey: 3, displayName: 'y', state: 'idle' },
      'nope',
      { paneKey: 'p4', displayName: 'z', agentType: 'claude', state: 'done', isLeader: false }
    ]
    const parsed = parseGameState(JSON.stringify({ ...STATE, agents }))
    expect(parsed?.agents.map((agent) => agent.displayName)).toEqual(['lead', 'tester', 'z'])
    expect(parsed?.agents[2]?.toolName).toBeNull()
  })

  it('keeps an agent Orca sends with a null name or type, named after its type or pane', () => {
    const agents = [
      {
        paneKey: 'tab:a',
        displayName: null,
        agentType: 'codex',
        state: 'working',
        isLeader: false
      },
      { paneKey: 'tab:b', displayName: null, agentType: null, state: 'idle', isLeader: false }
    ]
    const parsed = parseGameState(JSON.stringify({ ...STATE, agents }))
    expect(parsed?.agents.map((agent) => [agent.displayName, agent.agentType])).toEqual([
      ['codex', 'codex'],
      ['tab:b', '']
    ])
  })

  it('turns an invalid review, work item or config field into null or nothing', () => {
    const parsed = parseGameState(
      JSON.stringify({
        ...STATE,
        config: { mode: 'loud', scene: '', hud: 'yes', rewards: true },
        review: { provider: 'sourcehut', number: 1, url: 'u', state: 'open', ci: 'none' },
        workItem: { provider: 'plane', identifier: 'A-1', statusGroup: 'later' }
      })
    )
    expect(parsed?.config).toEqual({ rewards: true })
    expect(parsed?.review).toBeNull()
    expect(parsed?.workItem).toBeNull()
  })

  it('reads an unknown CI status as none, a missing title as empty, and missing lists as empty', () => {
    const parsed = parseGameState(
      JSON.stringify({
        review: { ...STATE.review, title: undefined, provider: 'gitea', ci: 'exploded' }
      })
    )
    expect(parsed?.review).toMatchObject({ provider: 'gitea', title: '', ci: 'none' })
    expect(parsed?.agents).toEqual([])
    expect(parsed?.warnings).toEqual([])
    expect(parsed?.worktree).toBeNull()
    expect(parsed?.workItem).toBeNull()
  })

  it('answers undefined for output that is not a JSON object', () => {
    expect(parseGameState('')).toBeUndefined()
    expect(parseGameState('not json')).toBeUndefined()
    expect(parseGameState('[1,2]')).toBeUndefined()
    expect(parseGameState(JSON.stringify({ ok: false, result: 'boom' }))).toBeUndefined()
  })
})
