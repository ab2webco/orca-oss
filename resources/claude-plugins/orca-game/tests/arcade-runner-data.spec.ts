import { describe, expect, it } from 'vitest'

import {
  ORCHESTRATOR_GAME_ARCADE_FPS_MAX,
  ORCHESTRATOR_GAME_ARCADE_FPS_MIN,
  ORCHESTRATOR_GAME_ARCADE_RUNNER,
  parseOrchestratorGameArcade
} from '../../../../src/shared/orchestrator-game-arcade-file'
import { ARCADE_FPS_MAX, ARCADE_FPS_MIN, ARCADE_RUNNER } from '../hooks/arcade-runner-data'

describe("the mod's copy of Orca's built-in runner", () => {
  it('is the runner Orca validates, defaults included', () => {
    const parsed = parseOrchestratorGameArcade(ORCHESTRATOR_GAME_ARCADE_RUNNER)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok ? parsed.game : undefined).toEqual(ARCADE_RUNNER)
  })

  it('caps the frame rate where Orca caps it', () => {
    expect([ARCADE_FPS_MIN, ARCADE_FPS_MAX]).toEqual([
      ORCHESTRATOR_GAME_ARCADE_FPS_MIN,
      ORCHESTRATOR_GAME_ARCADE_FPS_MAX
    ])
  })
})
