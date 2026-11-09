import { describe, expect, it } from 'vitest'

import {
  runnerOf as sharedRunnerOf,
  runnerStartOf as sharedStartOf,
  runnerStepOf as sharedStepOf
} from '../../../../src/shared/orchestrator-game-arcade-runner-rules'
import { runnerOf, runnerStartOf, runnerStepOf } from '../hooks/arcade-runner'
import { ARCADE_RUNNER } from '../hooks/arcade-runner-data'

// Why: Orca's panel plays src/shared's port; until ORCA-1055 drops the terminal arcade, both copies
// must be one game, so a seeded run with the same presses lands on the same frames.
const SHAPES = [
  { heights: [4, 4], weight: 1 },
  { heights: [3, 5, 3], weight: 0.35 }
]

describe("Orca's port of the runner rules", () => {
  it('plays the same run as the mod for the same seed and presses, to the game over', () => {
    const mod = runnerOf(ARCADE_RUNNER, SHAPES)
    const shared = sharedRunnerOf(ARCADE_RUNNER, SHAPES)
    for (const seed of [1, 42, 9001]) {
      let a = runnerStartOf(mod, seed)
      let b = sharedStartOf(shared, seed)
      expect(b).toEqual(a)
      for (let frame = 0; frame < 4000 && !a.isOver; frame += 1) {
        const isJump = frame % 23 === 0 || frame % 37 === 5
        const dt = 50 + (frame % 7) * 9
        a = runnerStepOf(mod, a, dt, isJump)
        b = sharedStepOf(shared, b, dt, isJump)
        expect(b).toEqual(a)
      }
      expect(a.score).toBeGreaterThan(0)
    }
  })
})
