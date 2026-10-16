import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
  ORCHESTRATOR_GAME_BUILT_IN_SCENES,
  parseOrchestratorGameLayer,
  resolveOrchestratorGameConfig
} from './orchestrator-game-config'

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
      'orchestratorGame.mode must be one of on, zen, off',
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
