import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_RUNNER } from '../../../../shared/orchestrator-game-arcade-file'
import { keepArcadeRun, keptArcadeRunOf } from './arcade-kept-runs'
import { arcadeRunOf, pressArcadeRun } from './arcade-run-state'

describe('kept arcade runs', () => {
  it('gives the run back to the same play, and none to a newer play of the tab', () => {
    const run = pressArcadeRun(arcadeRunOf(JSON.parse(ORCHESTRATOR_GAME_ARCADE_RUNNER), 3)).run
    expect(keptArcadeRunOf('orca-arcade::wt', 1)).toBeUndefined()
    keepArcadeRun('orca-arcade::wt', 1, run)
    expect(keptArcadeRunOf('orca-arcade::wt', 1)).toBe(run)
    expect(keptArcadeRunOf('orca-arcade::wt', 2)).toBeUndefined()
    expect(keptArcadeRunOf('orca-arcade::other', 1)).toBeUndefined()
  })
})
