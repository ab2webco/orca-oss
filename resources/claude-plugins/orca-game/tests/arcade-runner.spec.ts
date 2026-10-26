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

  it('jumps once from the ground, peaks at its rows in pixels and lands after its time', () => {
    const jumped = runnerStepOf(RUNNER, runnerStartOf(RUNNER, 1), 0, true)
    expect(jumped.jumpMs).toBe(0)
    const half = ARCADE_RUNNER.jump.ms / 2
    const peak = run(jumped, half, half / 5)
    expect(runnerHeightOf(RUNNER, peak)).toBeCloseTo(ARCADE_RUNNER.jump.rows * 2, 5)
    expect(peak.jumpMs).toBeCloseTo(half, 5)
    expect(runnerStepOf(RUNNER, peak, 50, true).jumpMs).toBeCloseTo(half + 50, 5)
    const landed = run(peak, ARCADE_RUNNER.jump.ms, 50)
    expect(landed.jumpMs).toBeUndefined()
    expect(runnerHeightOf(RUNNER, landed)).toBe(0)
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

  it('clears every obstacle when the jump is timed, even at max speed', () => {
    let state: RunnerState = { ...runnerStartOf(RUNNER, 5), ms: 10 * 60_000 }
    const step = 1000 / 15
    for (let i = 0; i < 15 * 60; i += 1) {
      const next = state.obstacles.find(
        (one) => one.x + widthOf(one.shape) > state.distance + HERO_HITBOX.left
      )
      const ahead = next === undefined ? Infinity : next.x - state.distance - HERO_HITBOX.left
      // Why this lead: take off on the frame that puts the peak nearest the obstacle's middle.
      const lead =
        (ARCADE_RUNNER.jump.ms / 2000) * state.speed -
        widthOf(next?.shape ?? 0) / 2 +
        HERO_HITBOX.width / 2
      const stride = (state.speed * step) / 1000
      state = runnerStepOf(RUNNER, state, step, Math.abs(ahead - lead) <= stride / 2)
    }
    expect(state.isOver).toBe(false)
    expect(state.distance).toBeGreaterThan(ARCADE_RUNNER.speed.max * 50)
  })

  it('never runs farther than a short step when a frame comes late', () => {
    const start = runnerStartOf(RUNNER, 1)
    expect(runnerStepOf(RUNNER, start, 60_000, false).distance).toBeLessThan(
      ARCADE_RUNNER.speed.start
    )
  })
})
