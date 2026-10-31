import { describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'
import { QUEST_SCENE } from '../hooks/scenes/quest'

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

  it('keeps the layer of each config key Orca names, dropping unknown keys and layers', () => {
    const sources = {
      mode: 'project',
      render: 'default',
      tracker: 'local',
      hud: 'env',
      extra: 'global'
    }
    expect(parseGameState(JSON.stringify({ ...STATE, sources }))?.sources).toEqual({
      mode: 'project',
      render: 'default',
      tracker: 'local'
    })
    expect(
      parseGameState(JSON.stringify({ ...STATE, sources: 'project' }))?.sources
    ).toBeUndefined()
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

  // Why: the handle goes into the CLI's argv, so only the `term_` shape Orca issues is kept.
  it('keeps a member the lead launched and the worktree it runs in, dropping a malformed one', () => {
    const member = { ...STATE.agents[1], isMember: true }
    const agents = [
      {
        ...member,
        paneKey: 'tab:a',
        worktree: { id: 'wt-8', branch: 'feat/cin-8', displayName: 'cin-8' }
      },
      { ...member, paneKey: 'tab:b', worktree: { id: 'wt-9', branch: 7 } },
      { ...STATE.agents[1], paneKey: 'tab:c', isMember: 'yes' }
    ]
    const parsed = parseGameState(JSON.stringify({ ...STATE, agents }))
    expect(parsed?.agents.map((agent) => [agent.isMember, agent.worktree])).toEqual([
      [true, { id: 'wt-8', branch: 'feat/cin-8', displayName: 'cin-8' }],
      [true, undefined],
      [undefined, undefined]
    ])
  })

  it('keeps a terminal handle only in the shape Orca issues', () => {
    const handles = ['term_3f2a-9c_b', '', '--json', 'term_a b', 'term_', 7, 'pty:1']
    const agents = handles.map((terminalHandle, index) => ({
      ...STATE.agents[1],
      paneKey: `tab:${index}`,
      terminalHandle
    }))
    const parsed = parseGameState(JSON.stringify({ ...STATE, agents }))
    expect(parsed?.agents.map((agent) => agent.terminalHandle)).toEqual([
      'term_3f2a-9c_b',
      ...handles.slice(1).map(() => undefined)
    ])
    expect(parsed?.agents[1]).not.toHaveProperty('terminalHandle')
  })

  // Why: View hands the id to `orca terminal focus --on`, so only an id that cannot read as a flag passes (ORCA-839).
  it("keeps a remote member's environment id only when it is safe to pass on", () => {
    const ids = ['3f2a9c1e-0b7d-4c55-9e1a-2b6f0d8c4a11', '--json', '', 7, 'a b']
    const agents = ids.map((environmentId, index) => ({
      ...STATE.agents[1],
      paneKey: `remote:ctx_${index}`,
      remote: { host: 'imac', stateKnown: true, environmentId }
    }))
    const parsed = parseGameState(JSON.stringify({ ...STATE, agents }))
    expect(parsed?.agents.map((agent) => agent.remote)).toEqual([
      { host: 'imac', stateKnown: true, environmentId: ids[0] },
      ...ids.slice(1).map(() => ({ host: 'imac', stateKnown: true }))
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

  it("keeps Orca's UI locale only when the game ships it", () => {
    const localeOf = (locale: unknown) =>
      parseGameState(JSON.stringify({ ...STATE, locale }))?.locale
    expect(localeOf('es')).toBe('es')
    expect(localeOf('en')).toBe('en')
    expect(localeOf('fr')).toBeUndefined()
    expect(localeOf(7)).toBeUndefined()
    expect(parseGameState(JSON.stringify(STATE))).not.toHaveProperty('locale')
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

  it('keeps the plugin scenes that are whole and namespaced, and drops the rest', () => {
    const definition = JSON.parse(JSON.stringify(QUEST_SCENE)) as Record<string, unknown>
    const parsed = parseGameState(
      JSON.stringify({
        ...STATE,
        extensions: {
          scenes: [
            { id: 'acme.space/orbit', pluginId: 'acme.space', definition },
            { id: 'quest', pluginId: 'acme.space', definition },
            {
              id: 'acme.space/flat',
              pluginId: 'acme.space',
              definition: { ...definition, band: 1 }
            },
            { id: 'acme.space/bare', pluginId: 'acme.space' },
            'scene'
          ]
        }
      })
    )
    expect(
      parsed?.extensions.scenes.map((one) => [one.id, one.pluginId, one.definition.id])
    ).toEqual([['acme.space/orbit', 'acme.space', 'acme.space/orbit']])
  })

  it("keeps a project's scene file under its file: id, and drops one that claims a plugin", () => {
    const definition = JSON.parse(JSON.stringify(QUEST_SCENE)) as Record<string, unknown>
    const parsed = parseGameState(
      JSON.stringify({
        ...STATE,
        extensions: {
          scenes: [
            { id: 'file:.orca/scenes/my scene.json', pluginId: 'file', definition },
            { id: 'file:.orca/scenes/a.json', pluginId: 'acme.space', definition },
            { id: 'file:', pluginId: 'file', definition },
            { id: 'file:x\u001b.json', pluginId: 'file', definition },
            { id: `file:${'a'.repeat(513)}`, pluginId: 'file', definition }
          ]
        }
      })
    )
    expect(
      parsed?.extensions.scenes.map((one) => [one.id, one.pluginId, one.definition.id])
    ).toEqual([['file:.orca/scenes/my scene.json', 'file', 'file:.orca/scenes/my scene.json']])
  })

  it('reads no scenes from a host that sends no extensions or a broken list', () => {
    expect(parseGameState(JSON.stringify(STATE))?.extensions).toEqual({ scenes: [] })
    expect(
      parseGameState(JSON.stringify({ ...STATE, extensions: { scenes: 'all' } }))?.extensions
    ).toEqual({ scenes: [] })
  })

  it('reads no links and no activity from a host older than them', () => {
    const parsed = parseGameState(JSON.stringify(STATE))
    expect(parsed?.links).toEqual([])
    expect(parsed?.activity).toBeNull()
    expect(parsed?.agents.every((agent) => !('activity' in agent))).toBe(true)
  })

  it('reads the links whole and http(s), dropping the malformed ones', () => {
    const ci = {
      id: 'ci',
      kind: 'ci',
      provider: 'github',
      label: 'CI',
      url: 'https://github.com/o/r/pull/42/checks',
      status: 'failure',
      tone: 'danger'
    }
    const plan = {
      id: 'project:0',
      kind: 'project',
      provider: 'project',
      label: 'Test plan',
      url: 'http://tambora.example/projects/CIN'
    }
    const parsed = parseGameState(
      JSON.stringify({
        ...STATE,
        links: [
          ci,
          { ...plan, tone: 'loud', status: 7 },
          { ...ci, id: 'x1', url: 'javascript:alert(1)' },
          { ...ci, id: 'x2', url: 'file:///etc/passwd' },
          { ...ci, id: 'x3', url: 'not a url' },
          { ...ci, id: 'x4', kind: 'chat' },
          { ...ci, id: 'x5', label: 42 },
          { ...ci, id: undefined },
          'https://github.com',
          null
        ]
      })
    )
    expect(parsed?.links).toEqual([ci, plan])
    expect(parseGameState(JSON.stringify({ ...STATE, links: 'all' }))?.links).toEqual([])
  })

  it('reads the calling pane and each agent activity, dropping one that is not whole', () => {
    const activity = {
      name: 'Tambora',
      id: 'TR-CIN-12',
      url: 'https://tambora.example/projects/CIN/testruns/TR-CIN-12',
      at: 1,
      running: true
    }
    const parsed = parseGameState(
      JSON.stringify({
        ...STATE,
        agents: [
          { ...STATE.agents[0], activity },
          { ...STATE.agents[1], activity: { ...activity, url: 'javascript:alert(1)' } }
        ],
        activity: { ...activity, running: 'yes' }
      })
    )
    expect(parsed?.agents[0]?.activity).toEqual(activity)
    expect(parsed?.agents[1]).not.toHaveProperty('activity')
    expect(parsed?.activity).toEqual({ ...activity, running: false })
    expect(
      parseGameState(JSON.stringify({ ...STATE, activity: { ...activity, id: '' } }))?.activity
    ).toBeNull()
  })

  it('answers undefined for output that is not a JSON object', () => {
    expect(parseGameState('')).toBeUndefined()
    expect(parseGameState('not json')).toBeUndefined()
    expect(parseGameState('[1,2]')).toBeUndefined()
    expect(parseGameState(JSON.stringify({ ok: false, result: 'boom' }))).toBeUndefined()
  })
})

describe('The perfect-merge decision on the wire', () => {
  it("keeps a review's perfectMerge only as a boolean", () => {
    const withFlag = (perfectMerge: unknown) =>
      parseGameState(JSON.stringify({ ...STATE, review: { ...STATE.review, perfectMerge } }))
        ?.review

    expect(withFlag(true)?.perfectMerge).toBe(true)
    expect(withFlag(false)?.perfectMerge).toBe(false)
    expect(withFlag('yes')).not.toHaveProperty('perfectMerge')
  })
})
