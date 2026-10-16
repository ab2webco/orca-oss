import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORCHESTRATOR_GAME_CONFIG,
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
