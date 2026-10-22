import { describe, expect, it } from 'vitest'

import {
  ORCHESTRATOR_GAME_VIEWS,
  orchestratorGameViewOf,
  orchestratorGameViewPatchOf
} from '../../../../src/shared/orchestrator-game-view'
import { parseGameState } from '../hooks/game-state'
import { GAME_VIEWS, gameViewOf, gameViewPatchOf } from '../hooks/game-view'

describe("the mod's mirror of Orca's view table", () => {
  it('has the same ids, order and costs', () => {
    expect(GAME_VIEWS).toEqual(ORCHESTRATOR_GAME_VIEWS)
  })

  it('maps every mode and render pair the same way', () => {
    for (const mode of ['on', 'zen', 'flat', 'off'] as const) {
      for (const render of ['classic', 'hd', 'hd-compact'] as const) {
        expect(gameViewOf({ mode, render })).toBe(orchestratorGameViewOf({ mode, render }))
        for (const { id } of GAME_VIEWS) {
          expect(gameViewPatchOf(id, { mode, render })).toEqual(
            orchestratorGameViewPatchOf(id, { mode, render })
          )
        }
      }
    }
  })
})

describe('a view Orca stores that only newer mods knew', () => {
  it('reads a configured flat from orca game state', () => {
    const state = parseGameState(
      JSON.stringify({
        config: { mode: 'flat' },
        agents: [],
        worktree: null,
        links: [],
        warnings: []
      })
    )
    expect(state?.config.mode).toBe('flat')
  })
})
