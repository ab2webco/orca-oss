import { describe, expect, it } from 'vitest'

import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const stateWith = (orchestratorGame: { mode?: 'zen'; show?: boolean }) =>
  buildOrchestratorGameState({
    settings: { orchestratorGame },
    worktree: null,
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none
  })

describe('Show the game in the state the mod reads', () => {
  it('hands the mod mode off while the game is hidden, from the layer that hid it', async () => {
    const state = await stateWith({ mode: 'zen', show: false })

    expect(state.config.mode).toBe('off')
    expect(state.config.show).toBe(false)
    expect(state.sources.mode).toBe('global')
  })

  it('hands the chosen mode while the game is shown', async () => {
    const state = await stateWith({ mode: 'zen' })

    expect(state.config.mode).toBe('zen')
    expect(state.config.show).toBe(true)
  })
})
