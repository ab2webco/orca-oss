import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  ORCHESTRATOR_GAME_BUILT_IN_SCENES,
  parseOrchestratorGameLayer,
  resolveOrchestratorGameConfig,
  resolveOrchestratorGameIntegrations,
  resolveOrchestratorGameLead,
  resolveOrchestratorGameRewardWeights
} from './orchestrator-game-config'
import { gameLeadSourceOf } from './orchestrator-game-lead-source'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import { DEFAULT_GAME_REWARD_WEIGHTS } from './orchestrator-game-reward-weights'

describe('resolveOrchestratorGameConfig', () => {
  it('uses the defaults when no layer sets anything', () => {
    const resolved = resolveOrchestratorGameConfig({})

    expect(resolved.config).toEqual(DEFAULT_ORCHESTRATOR_GAME_CONFIG)
    expect(resolved.config.mode).toBe('on')
    expect(resolved.sources.mode).toBe('default')
  })

  it('lets the project override global settings and the local override win over both', () => {
    const resolved = resolveOrchestratorGameConfig({
      global: { mode: 'zen', hud: false },
      project: { mode: 'off', tracker: false },
      local: { mode: 'on' }
    })

    expect(resolved.config).toMatchObject({
      mode: 'on',
      hud: false,
      tracker: false
    })
    expect(resolved.sources).toMatchObject({
      mode: 'local',
      hud: 'global',
      tracker: 'project',
      rewards: 'default'
    })
  })
})

describe('openLinks', () => {
  it('opens links in Orca by default and in the system browser when a layer asks', () => {
    expect(resolveOrchestratorGameConfig({}).config.openLinks).toBe('orca')
    const resolved = resolveOrchestratorGameConfig({
      global: { openLinks: 'system' },
      project: { openLinks: 'orca' },
      local: { openLinks: 'system' }
    })
    expect(resolved.config.openLinks).toBe('system')
    expect(resolved.sources.openLinks).toBe('local')
  })

  it('reads it from orca.yaml, dropping anything but orca or system', () => {
    expect(parseOrchestratorGameLayer({ openLinks: 'system' })).toEqual({
      layer: { openLinks: 'system' },
      warnings: []
    })
    expect(parseOrchestratorGameLayer({ openLinks: 'chrome' })).toEqual({
      layer: {},
      warnings: ['orchestratorGame.openLinks must be orca or system']
    })
  })
})

describe('reviews', () => {
  it("reads the PR list's action from orca.yaml, this machine's layer replacing it", () => {
    const { layer, warnings } = parseOrchestratorGameLayer({ reviews: { action: 'prs' } })
    expect(layer).toEqual({ reviews: { action: 'prs' } })
    expect(warnings).toEqual([])
    expect(
      resolveOrchestratorGameIntegrations({ project: layer, local: { reviews: {} } }).reviews
    ).toEqual({})
    expect(resolveOrchestratorGameIntegrations({ project: layer }).reviews).toEqual({
      action: 'prs'
    })
  })
})

describe('resolveOrchestratorGameConfig sceneFile', () => {
  it('draws a project layer scene file over a scene at the same or a lower layer', () => {
    const resolved = resolveOrchestratorGameConfig({
      global: { scene: 'jrpg' },
      project: { scene: 'tamer', sceneFile: './.orca/scenes/mario.json' }
    })

    expect(resolved.config.scene).toBe('file:.orca/scenes/mario.json')
    expect(resolved.sources.scene).toBe('project')
    expect(resolved.sceneFile).toBe('.orca/scenes/mario.json')
    expect(resolved.warnings).toEqual([])
  })

  it('lets a scene at a higher layer win over a lower scene file', () => {
    const resolved = resolveOrchestratorGameConfig({
      project: { sceneFile: '.orca/scenes/mario.json' },
      local: { scene: 'vigilante' }
    })

    expect(resolved.config.scene).toBe('vigilante')
    expect(resolved.sources.scene).toBe('local')
    expect(resolved.sceneFile).toBeNull()
  })

  it("lets this machine's scene file win over orca.yaml's scene", () => {
    const resolved = resolveOrchestratorGameConfig({
      project: { scene: 'jrpg' },
      local: { sceneFile: 'scenes/space.json' }
    })

    expect(resolved.config.scene).toBe('file:scenes/space.json')
    expect(resolved.sources.scene).toBe('local')
    expect(resolved.sceneFile).toBe('scenes/space.json')
  })

  it('never reads a scene file from global Settings', () => {
    const resolved = resolveOrchestratorGameConfig({
      global: { scene: 'jrpg', sceneFile: 'scenes/space.json' }
    })

    expect(resolved.config.scene).toBe('jrpg')
    expect(resolved.sceneFile).toBeNull()
    expect(resolved.warnings).toEqual([
      'orchestratorGame.sceneFile is read only from orca.yaml or the project Settings'
    ])
  })

  it('drops a scene file that is absolute or leaves the worktree, keeping the scene below it', () => {
    const resolved = resolveOrchestratorGameConfig({
      project: { scene: 'tamer' },
      local: { sceneFile: '../secrets/scene.json' }
    })

    expect(resolved.config.scene).toBe('tamer')
    expect(resolved.sources.scene).toBe('project')
    expect(resolved.sceneFile).toBeNull()
    expect(resolved.warnings).toEqual([
      'orchestratorGame.sceneFile must stay inside the worktree (no ..)'
    ])
    expect(
      resolveOrchestratorGameConfig({ project: { sceneFile: '/etc/scene.json' } }).warnings
    ).toEqual(['orchestratorGame.sceneFile must be relative to the worktree root, not absolute'])
  })
})

describe('parseOrchestratorGameLayer', () => {
  it('keeps the valid fields of an orca.yaml section', () => {
    expect(
      parseOrchestratorGameLayer({
        mode: 'zen',
        scene: 'quest',
        hud: true,
        rewards: false
      })
    ).toEqual({
      layer: { mode: 'zen', scene: 'quest', hud: true, rewards: false },
      warnings: []
    })
  })

  it('accepts every built-in scene id from orca.yaml', () => {
    expect(ORCHESTRATOR_GAME_BUILT_IN_SCENES).toEqual(['quest', 'vigilante', 'jrpg', 'tamer'])
    for (const scene of ORCHESTRATOR_GAME_BUILT_IN_SCENES) {
      expect(parseOrchestratorGameLayer({ scene })).toEqual({ layer: { scene }, warnings: [] })
    }
  })

  it('keeps a scene file relative to the worktree and drops one that leaves it', () => {
    expect(parseOrchestratorGameLayer({ sceneFile: '.orca/scenes/mario.json' })).toEqual({
      layer: { sceneFile: '.orca/scenes/mario.json' },
      warnings: []
    })
    expect(parseOrchestratorGameLayer({ sceneFile: '../mario.json', scene: 'quest' })).toEqual({
      layer: { scene: 'quest' },
      warnings: ['orchestratorGame.sceneFile must stay inside the worktree (no ..)']
    })
    expect(parseOrchestratorGameLayer({ sceneFile: 3 }).warnings).toEqual([
      'orchestratorGame.sceneFile must be a path to a JSON file inside the worktree'
    ])
  })

  it('drops invalid values with a warning instead of failing', () => {
    const parsed = parseOrchestratorGameLayer({
      mode: 'loud',
      hud: 'yes',
      scene: '',
      extra: 1
    })

    expect(parsed.layer).toEqual({})
    expect(parsed.warnings).toEqual([
      'orchestratorGame.mode must be one of on, zen, flat, off',
      'orchestratorGame.hud must be true or false',
      'orchestratorGame.scene must be a non-empty scene id',
      'orchestratorGame.extra is not a known setting'
    ])
  })

  it('treats a missing or non-object section as empty', () => {
    expect(parseOrchestratorGameLayer(undefined)).toEqual({
      layer: {},
      warnings: []
    })
    expect(parseOrchestratorGameLayer('on')).toEqual({
      layer: {},
      warnings: ['orchestratorGame must be a mapping']
    })
  })
})

describe('orchestratorGame.actions', () => {
  it('reads actions from orca.yaml, reporting the ones it drops', () => {
    expect(
      parseOrchestratorGameLayer({
        actions: [{ label: 'QA', prompt: 'List my tickets in QA' }, { label: 'Broken' }]
      })
    ).toEqual({
      layer: { actions: [{ label: 'QA', prompt: 'List my tickets in QA' }] },
      warnings: ['orchestratorGame.actions[1] must have either prompt or mcp']
    })
  })

  it("lets this machine's actions replace the project's whole list", () => {
    const project = { actions: [{ label: 'A', prompt: 'a' }] }
    expect(resolveOrchestratorGameIntegrations({ project }).actions).toEqual(project.actions)
    expect(
      resolveOrchestratorGameIntegrations({
        project,
        local: { actions: [{ label: 'B', mcp: { server: 'tambora', tool: 'list' } }] }
      }).actions
    ).toEqual([{ label: 'B', mcp: { server: 'tambora', tool: 'list' } }])
  })

  it("keeps the To Do's work prompt", () => {
    expect(
      parseOrchestratorGameLayer({
        todo: { provider: 'jira', project: 'CIN', workPrompt: '/o:launch {id}' }
      }).layer.todo
    ).toEqual({ provider: 'jira', project: 'CIN', workPrompt: '/o:launch {id}' })
    expect(
      parseOrchestratorGameLayer({ todo: { provider: 'jira', workPrompt: 'Go {ticket}' } }).warnings
    ).toEqual(['orchestratorGame.todo.workPrompt uses an unknown placeholder {ticket}'])
  })
})

describe('orchestratorGame.orchestrator', () => {
  it('reads the lead block from orca.yaml, reporting the keys it drops', () => {
    expect(
      parseOrchestratorGameLayer({ orchestrator: { cap: 2, rules: 'Report to me', cap2: 1 } })
    ).toEqual({
      layer: { orchestrator: { cap: 2, rules: 'Report to me' } },
      warnings: ['orchestratorGame.orchestrator.cap2 is not a known setting']
    })
  })

  it("merges the lead key by key, this machine's Settings over orca.yaml over global", () => {
    expect(resolveOrchestratorGameLead({})).toEqual(DEFAULT_GAME_LEAD)
    expect(
      resolveOrchestratorGameLead({
        global: { orchestrator: { agent: 'codex' } },
        project: { orchestrator: { cap: 3, rules: 'CIN flow', label: 'orquestador' } },
        local: { orchestrator: { label: 'Jefe', model: 'opus' } }
      })
    ).toEqual({
      ...DEFAULT_GAME_LEAD,
      agent: 'codex',
      cap: 3,
      rules: 'CIN flow',
      label: 'Jefe',
      model: 'opus'
    })
  })
})

describe('gameLeadSourceOf', () => {
  it('names the highest layer that sets a valid value for the key', () => {
    const layers = {
      global: { orchestrator: { cap: 2, agent: 'codex' } },
      project: { orchestrator: { cap: 6 } },
      local: { orchestrator: { cap: 999, label: 'Boss' } }
    }
    expect(gameLeadSourceOf(layers, 'cap')).toBe('project')
    expect(gameLeadSourceOf(layers, 'agent')).toBe('global')
    expect(gameLeadSourceOf(layers, 'label')).toBe('local')
    expect(gameLeadSourceOf(layers, 'autostart')).toBe('default')
  })

  it('reports an effort with no model as the default, since the lead drops it', () => {
    expect(gameLeadSourceOf({ project: { orchestrator: { effort: 'high' } } }, 'effort')).toBe(
      'default'
    )
    expect(
      gameLeadSourceOf(
        {
          project: { orchestrator: { model: 'opus' } },
          local: { orchestrator: { effort: 'high' } }
        },
        'effort'
      )
    ).toBe('local')
  })
})

describe('orchestratorGame.rewardWeights', () => {
  it('parses the weights and warns on a bad one, leaving the rewards switch alone', () => {
    expect(
      parseOrchestratorGameLayer({
        rewards: true,
        rewardWeights: { 'ci-green': 5, 'work-item-done': -1 }
      })
    ).toEqual({
      layer: { rewards: true, rewardWeights: { 'ci-green': 5 } },
      warnings: [
        'orchestratorGame.rewardWeights.work-item-done must be a whole number from 0 to 1000'
      ]
    })
  })

  it('applies the project weights over global and the local ones over both, a bad value falling back', () => {
    expect(
      resolveOrchestratorGameRewardWeights({
        global: { rewardWeights: { 'ci-green': 1 } },
        project: { rewardWeights: { 'ci-green': 5, 'member-claimed': 0 } },
        local: { rewardWeights: { 'review-merged': 300, 'work-item-review': 2.5 } }
      })
    ).toEqual({
      ...DEFAULT_GAME_REWARD_WEIGHTS,
      'ci-green': 5,
      'member-claimed': 0,
      'review-merged': 300
    })
    expect(resolveOrchestratorGameRewardWeights({})).toEqual(DEFAULT_GAME_REWARD_WEIGHTS)
  })
})
