import { describe, expect, it } from 'vitest'

import {
  parseOrchestratorGameLayer,
  resolveOrchestratorGameConfig
} from './orchestrator-game-config'
import type { OrchestratorGameRender } from './orchestrator-game-render'
import {
  ORCHESTRATOR_GAME_VIEWS,
  orchestratorGameViewOf,
  orchestratorGameViewPatchOf,
  shownOrchestratorGameModeOf,
  suggestedOrchestratorGameView
} from './orchestrator-game-view'

const GIB = 1024 ** 3

const RENDERS: readonly OrchestratorGameRender[] = ['classic', 'hd', 'hd-compact']

describe('the game view table', () => {
  it('lists the views in the ticket order with a fixed cost each', () => {
    expect(ORCHESTRATOR_GAME_VIEWS).toEqual([
      { id: 'off', cost: 'light' },
      { id: 'flat', cost: 'light' },
      { id: 'zen', cost: 'medium' },
      { id: '2d-classic', cost: 'medium' },
      { id: '2d-hd', cost: 'heavy' }
    ])
  })

  it('names the view a mode and render resolve to', () => {
    expect(orchestratorGameViewOf({ mode: 'off', render: 'hd' })).toBe('off')
    expect(orchestratorGameViewOf({ mode: 'flat', render: 'hd' })).toBe('flat')
    expect(orchestratorGameViewOf({ mode: 'zen', render: 'hd' })).toBe('zen')
    expect(orchestratorGameViewOf({ mode: 'on', render: 'classic' })).toBe('2d-classic')
    expect(orchestratorGameViewOf({ mode: 'on', render: 'hd' })).toBe('2d-hd')
    expect(orchestratorGameViewOf({ mode: 'on', render: 'hd-compact' })).toBe('2d-hd')
  })

  it('maps each view back to the mode and render that store it', () => {
    const now = { mode: 'zen', render: 'hd-compact' } as const
    expect(orchestratorGameViewPatchOf('off', now)).toEqual({ mode: 'off' })
    expect(orchestratorGameViewPatchOf('flat', now)).toEqual({ mode: 'flat' })
    expect(orchestratorGameViewPatchOf('zen', now)).toEqual({ mode: 'zen' })
    expect(orchestratorGameViewPatchOf('2d-classic', now)).toEqual({
      mode: 'on',
      render: 'classic'
    })
    // Why kept: 2D hd covers both hd looks, so picking it must not undo a chosen hd-compact.
    expect(orchestratorGameViewPatchOf('2d-hd', now)).toEqual({ mode: 'on', render: 'hd-compact' })
    expect(orchestratorGameViewPatchOf('2d-hd', { mode: 'on', render: 'classic' })).toEqual({
      mode: 'on',
      render: 'hd'
    })
  })

  it('round-trips every view from every starting render', () => {
    for (const { id } of ORCHESTRATOR_GAME_VIEWS) {
      for (const render of RENDERS) {
        const patched = {
          mode: 'on' as const,
          render,
          ...orchestratorGameViewPatchOf(id, { mode: 'on', render })
        }
        expect(orchestratorGameViewOf(patched)).toBe(id)
      }
    }
  })
})

describe('flat as a configured mode', () => {
  it('is accepted from orca.yaml and Settings layers', () => {
    expect(parseOrchestratorGameLayer({ mode: 'flat' })).toEqual({
      layer: { mode: 'flat' },
      warnings: []
    })
    expect(resolveOrchestratorGameConfig({ project: { mode: 'flat' } }).config.mode).toBe('flat')
  })
})

describe('the suggested view', () => {
  it('follows the host memory: flat when small or short, 2D classic up to 16 GiB, else 2D hd', () => {
    expect(suggestedOrchestratorGameView({ totalMemory: 8 * GIB, availableMemory: 4 * GIB })).toBe(
      'flat'
    )
    expect(suggestedOrchestratorGameView({ totalMemory: 32 * GIB, availableMemory: 1 * GIB })).toBe(
      'flat'
    )
    expect(suggestedOrchestratorGameView({ totalMemory: 16 * GIB, availableMemory: 6 * GIB })).toBe(
      '2d-classic'
    )
    expect(suggestedOrchestratorGameView({ totalMemory: 32 * GIB, availableMemory: 6 * GIB })).toBe(
      '2d-hd'
    )
  })
})

describe('Show the game', () => {
  it('is a layered switch that hides the game and keeps the chosen mode', () => {
    expect(parseOrchestratorGameLayer({ show: false })).toEqual({
      layer: { show: false },
      warnings: []
    })
    const resolved = resolveOrchestratorGameConfig({
      global: { mode: 'zen' },
      local: { show: false }
    })
    expect(resolved.config).toMatchObject({ mode: 'zen', show: false })
    expect(resolved.sources.show).toBe('local')
    expect(shownOrchestratorGameModeOf(resolved.config)).toBe('off')
    expect(shownOrchestratorGameModeOf({ ...resolved.config, show: true })).toBe('zen')
  })

  it('is on by default', () => {
    expect(resolveOrchestratorGameConfig({}).config.show).toBe(true)
  })
})
