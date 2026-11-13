import { describe, expect, it } from 'vitest'

import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const stateWith = (orchestratorGame: { mode?: 'zen'; band?: boolean; hud?: boolean }) =>
  buildOrchestratorGameState({
    settings: { orchestratorGame },
    worktree: null,
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none
  })

describe('the terminal band in the state the mod reads', () => {
  it('hands the mod flat and no HUD while the band is off, the default', async () => {
    const state = await stateWith({ mode: 'zen' })

    expect(state.config.mode).toBe('flat')
    expect(state.config.hud).toBe(false)
    expect(state.config.band).toBe(false)
  })

  it('hands the chosen mode and HUD while the band is on', async () => {
    const state = await stateWith({ mode: 'zen', band: true })

    expect(state.config.mode).toBe('zen')
    expect(state.config.hud).toBe(true)
  })
})
