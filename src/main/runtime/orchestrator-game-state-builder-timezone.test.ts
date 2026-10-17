import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const stateWith = (timezone?: string) =>
  buildOrchestratorGameState({
    settings: timezone === undefined ? undefined : { orchestratorGame: { timezone } },
    worktree: null,
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none
  })

describe('the clock the game state hands the mod', () => {
  // Why: over SSH the mod runs on the host, whose own clock is usually UTC.
  it('turns local into the desktop’s own zone and keeps where the value came from', async () => {
    const state = await stateWith()
    expect(state.config.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(state.config.timezone).not.toBe('local')
    expect(state.sources.timezone).toBe('default')
  })

  it('passes a named zone through', async () => {
    expect((await stateWith('Asia/Tokyo')).config.timezone).toBe('Asia/Tokyo')
  })
})
