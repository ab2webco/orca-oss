import { describe, expect, it } from 'vitest'
import {
  parseOrchestratorGameLayer,
  resolveOrchestratorGameConfig
} from './orchestrator-game-config'
import { isOrchestratorGameTimezone } from './orchestrator-game-render'

describe('render and timezone', () => {
  it('draws classic on local time unless a layer says otherwise', () => {
    const resolved = resolveOrchestratorGameConfig({})
    expect(resolved.config.render).toBe('classic')
    expect(resolved.config.timezone).toBe('local')
    expect(resolved.sources.render).toBe('default')
    expect(resolved.sources.timezone).toBe('default')
  })

  it('resolves each key through global < orca.yaml < project Settings with its source', () => {
    const resolved = resolveOrchestratorGameConfig({
      global: { render: 'hd', timezone: 'America/Bogota' },
      project: { timezone: 'Europe/Madrid' },
      local: { render: 'classic' }
    })
    expect(resolved.config).toMatchObject({ render: 'classic', timezone: 'Europe/Madrid' })
    expect(resolved.sources).toMatchObject({ render: 'local', timezone: 'project' })
  })

  it('reads them from orca.yaml and warns on a render or timezone it does not know', () => {
    expect(parseOrchestratorGameLayer({ render: 'hd', timezone: 'Asia/Tokyo' })).toEqual({
      layer: { render: 'hd', timezone: 'Asia/Tokyo' },
      warnings: []
    })
    expect(parseOrchestratorGameLayer({ render: 'hd-compact' })).toEqual({
      layer: { render: 'hd-compact' },
      warnings: []
    })
    expect(parseOrchestratorGameLayer({ render: 'hdr', timezone: 'Mars/Olympus' })).toEqual({
      layer: {},
      warnings: [
        'orchestratorGame.render must be classic, hd or hd-compact',
        'orchestratorGame.timezone must be local or an IANA time zone such as America/Bogota'
      ]
    })
  })

  it('skips a hand-edited Settings value it does not know, with a warning, and keeps the layer below', () => {
    const resolved = resolveOrchestratorGameConfig({
      global: { render: 'hd', timezone: 'America/Bogota' },
      local: JSON.parse('{"render":"neon","timezone":"Nowhere/Land"}')
    })
    expect(resolved.config).toMatchObject({ render: 'hd', timezone: 'America/Bogota' })
    expect(resolved.sources).toMatchObject({ render: 'global', timezone: 'global' })
    expect(resolved.warnings).toEqual([
      'orchestratorGame.render must be classic, hd or hd-compact',
      'orchestratorGame.timezone must be local or an IANA time zone such as America/Bogota'
    ])
  })

  it('accepts local and real IANA names only', () => {
    expect(isOrchestratorGameTimezone('local')).toBe(true)
    expect(isOrchestratorGameTimezone('America/Bogota')).toBe(true)
    expect(isOrchestratorGameTimezone('UTC')).toBe(true)
    expect(isOrchestratorGameTimezone('')).toBe(false)
    expect(isOrchestratorGameTimezone('Mars/Olympus')).toBe(false)
    expect(isOrchestratorGameTimezone(5)).toBe(false)
  })
})
