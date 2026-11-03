import { describe, expect, it } from 'vitest'

import {
  HERO_HITBOX,
  runnerHeightOf,
  runnerOf,
  runnerStartOf,
  runnerStepOf,
  type RunnerState
} from '../hooks/arcade-runner'
import { ARCADE_RUNNER } from '../hooks/arcade-runner-data'
import { JUMP_BUFFER_MS, RUNNER_CEILING, runnerAirtimeOf } from '../hooks/arcade-runner-jump'

// The tallest and widest a scene obstacle gets, and the built-in rock.
const SHAPES = [
  { heights: [4, 4, 4, 4, 4], weight: 1 },
  { heights: [2, 3, 3, 2], weight: 0.35 }
]
const widthOf = (shape: number): number => SHAPES[shape]!.heights.length
const RUNNER = runnerOf(ARCADE_RUNNER, SHAPES)

const run = (state: RunnerState, ms: number, step = 1000 / 12): RunnerState => {
  let at = state
  for (let i = Math.round(ms / step); i > 0; i -= 1) {
    at = runnerStepOf(RUNNER, at, step, false)
  }
  return at
}

describe('the runner', () => {
  it('moves at its start speed and ramps up to its max, by time and not by frame count', () => {
    const start = runnerStartOf(RUNNER, 1)
    const coarse = run(start, 1000, 100)
    expect(coarse.distance).toBeCloseTo(ARCADE_RUNNER.speed.start, 0)
    const fine = run(start, 1000, 1000 / 15)
    expect(fine.distance).toBeCloseTo(coarse.distance, 0)
    const late = { ...start, ms: 10 * 60_000 }
    expect(runnerStepOf(RUNNER, late, 100, false).speed).toBe(ARCADE_RUNNER.speed.max)
  })

  it('takes off at the press, peaks at its rows in pixels and lands after its airtime', () => {
    const jumped = runnerStepOf(RUNNER, runnerStartOf(RUNNER, 1), 0, true)
    expect(jumped.air?.ms).toBe(0)
    const airtime = runnerAirtimeOf(ARCADE_RUNNER, jumped.speed)
    const peak = run(jumped, airtime / 2, airtime / 10)
    expect(runnerHeightOf(RUNNER, peak)).toBeCloseTo(ARCADE_RUNNER.jump.rows * 2, 5)
    const landed = run(peak, airtime / 2 + 50, 25)
    expect(landed.air).toBeUndefined()
    expect(runnerHeightOf(RUNNER, landed)).toBe(0)
  })

  it('jumps farther in columns but for less time as the run speeds up', () => {
    const { start, max } = ARCADE_RUNNER.speed
    const slow = runnerAirtimeOf(ARCADE_RUNNER, start)
    const fast = runnerAirtimeOf(ARCADE_RUNNER, max)
    expect(slow).toBe(ARCADE_RUNNER.jump.ms)
    expect(fast).toBeLessThan(slow)
    expect(fast * max).toBeGreaterThan(slow * start)
  })

  it('jumps once more in the air, never above its ceiling, and only once until it lands', () => {
    const jumped = runnerStepOf(RUNNER, runnerStartOf(RUNNER, 1), 0, true)
    const airtime = runnerAirtimeOf(ARCADE_RUNNER, jumped.speed)
    const top = run(jumped, airtime / 2, airtime / 10)
    const again = runnerStepOf(RUNNER, top, 0, true)
    expect(again.hasAirJump).toBe(false)
    let highest = 0
    let state = again
    for (let i = 0; i < 40 && state.air !== undefined; i += 1) {
      state = runnerStepOf(RUNNER, state, 25, i === 5)
      highest = Math.max(highest, runnerHeightOf(RUNNER, state))
    }
    const peak = ARCADE_RUNNER.jump.rows * 2
    expect(highest).toBeGreaterThan(peak)
    expect(highest).toBeLessThanOrEqual(peak * RUNNER_CEILING + 1e-9)
    expect(state.air).toBeUndefined()
    expect(state.hasAirJump).toBe(true)
  })

  it('keeps a press that comes just before touchdown and takes off again as it lands', () => {
    const jumped = runnerStepOf(RUNNER, runnerStartOf(RUNNER, 1), 0, true)
    const airtime = runnerAirtimeOf(ARCADE_RUNNER, jumped.speed)
    const late = run(jumped, airtime - JUMP_BUFFER_MS / 2, 10)
    const pressed = runnerStepOf(RUNNER, late, 0, true)
    expect(pressed.isBuffered).toBe(true)
    expect(pressed.hasAirJump).toBe(true)
    const bounced = run(pressed, JUMP_BUFFER_MS, 10)
    expect(bounced.air).toBeDefined()
    expect(bounced.isBuffered).toBe(false)
    expect(runnerHeightOf(RUNNER, bounced)).toBeGreaterThan(0)
  })

  it('spawns obstacles ahead with gaps inside the difficulty range, the same for the same seed', () => {
    const a = run(runnerStartOf(RUNNER, 7), 0)
    expect(a.obstacles.length).toBeGreaterThan(2)
    for (let i = 1; i < a.obstacles.length; i += 1) {
      const before = a.obstacles[i - 1]!
      const gap = a.obstacles[i]!.x - before.x - widthOf(before.shape)
      expect(gap).toBeGreaterThanOrEqual(ARCADE_RUNNER.difficulty.minGap)
      expect(gap).toBeLessThanOrEqual(ARCADE_RUNNER.difficulty.maxGap)
    }
    expect(runnerStartOf(RUNNER, 7).obstacles).toEqual(a.obstacles)
    expect(runnerStartOf(RUNNER, 8).obstacles).not.toEqual(a.obstacles)
  })

  it('ends the run when the hero runs into an obstacle, and scores the distance until then', () => {
    let state = runnerStartOf(RUNNER, 3)
    for (let i = 0; i < 2000 && !state.isOver; i += 1) {
      state = runnerStepOf(RUNNER, state, 1000 / 12, false)
    }
    expect(state.isOver).toBe(true)
    const first = state.obstacles.find(
      (one) => one.x + widthOf(one.shape) > state.distance + HERO_HITBOX.left
    )
    expect(first!.x - state.distance).toBeLessThan(HERO_HITBOX.left + HERO_HITBOX.width)
    expect(state.score).toBeGreaterThan(0)
    expect(runnerStepOf(RUNNER, state, 1000, true)).toBe(state)
  })

  it('never runs farther than a short step when a frame comes late', () => {
    const start = runnerStartOf(RUNNER, 1)
    expect(runnerStepOf(RUNNER, start, 60_000, false).distance).toBeLessThan(
      ARCADE_RUNNER.speed.start
    )
  })
})
