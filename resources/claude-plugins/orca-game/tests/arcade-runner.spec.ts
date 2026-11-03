import { describe, expect, it } from 'vitest'

import {
  HERO_HEIGHT,
  HERO_HITBOX,
  HERO_LEFT,
  STAR_POINTS,
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

  it('jumps from the ground, peaks at its rows in pixels and lands', () => {
    const jumped = runnerStepOf(RUNNER, runnerStartOf(RUNNER, 1), 0, true)
    expect(jumped.air?.ms).toBe(0)
    let peak = 0
    let state = jumped
    for (let i = 0; i < 200 && state.air !== undefined; i += 1) {
      state = runnerStepOf(RUNNER, state, 10, false)
      peak = Math.max(peak, runnerHeightOf(RUNNER, state))
    }
    expect(peak).toBeCloseTo(ARCADE_RUNNER.jump.rows * 2, 0)
    expect(state.air).toBeUndefined()
    expect(runnerHeightOf(RUNNER, state)).toBe(0)
  })

  it('stays up longer in time but not shorter in columns as the run speeds up', () => {
    const airOf = (ms: number) => {
      const speed = Math.min(
        ARCADE_RUNNER.speed.max,
        ARCADE_RUNNER.speed.start + (ARCADE_RUNNER.speed.rampPerMinute * ms) / 60_000
      )
      let state = runnerStepOf(RUNNER, { ...runnerStartOf(RUNNER, 1), ms, speed }, 0, true)
      const from = state.distance
      let air = 0
      while (state.air !== undefined) {
        state = runnerStepOf(RUNNER, state, 10, false)
        air += 10
      }
      return { air, columns: state.distance - from }
    }
    const slow = airOf(0)
    const fast = airOf(10 * 60_000)
    expect(slow.air).toBeGreaterThan(fast.air)
    expect(fast.columns).toBeGreaterThanOrEqual(slow.columns)
  })

  it('jumps again once in the air, higher than one jump reaches, and never a third time', () => {
    const peakOf = (presses: number[]) => {
      let state = runnerStartOf(RUNNER, 1)
      let peak = 0
      for (let ms = 0; ms < 3000; ms += 10) {
        state = runnerStepOf(RUNNER, state, 10, presses.includes(ms))
        peak = Math.max(peak, runnerHeightOf(RUNNER, state))
      }
      return { peak, state }
    }
    const one = peakOf([0])
    const two = peakOf([0, 300])
    expect(two.peak).toBeGreaterThan(one.peak + 2)
    expect(peakOf([0, 300, 450]).peak).toBeCloseTo(two.peak, 5)
  })

  it('takes off on landing when a press with both jumps spent came just before it', () => {
    let spent = runnerStepOf(RUNNER, runnerStartOf(RUNNER, 1), 0, true)
    spent = runnerStepOf(RUNNER, runnerStepOf(RUNNER, spent, 10, false), 0, true)
    const before = (ms: number) => {
      let state = spent
      while (run(state, ms, 10).air !== undefined) {
        state = runnerStepOf(RUNNER, state, 10, false)
      }
      return state
    }
    const soon = before(80)
    expect(run(soon, 100, 10).air).toBeUndefined()
    const buffered = run(runnerStepOf(RUNNER, soon, 0, true), 100, 10)
    expect(buffered.air?.jumps).toBe(1)
    const early = runnerStepOf(RUNNER, before(400), 0, true)
    expect(run(early, 450, 10).air).toBeUndefined()
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

  it('puts stars over some obstacles and a few higher ones only a double jump reaches', () => {
    const far = run(runnerStartOf(RUNNER, 4), 0)
    let stars = [...far.stars]
    let state = far
    for (let i = 0; i < 40; i += 1) {
      state = { ...state, distance: state.distance + 150 }
      state = runnerStepOf(RUNNER, state, 0, false)
      stars = [...stars, ...state.stars.filter((one) => !stars.some((s) => s.x === one.x))]
    }
    const heights = new Set(stars.map((one) => one.h))
    expect(heights.size).toBe(2)
    const [low, high] = [...heights].sort((a, b) => a - b)
    expect(high! - HERO_HEIGHT).toBeGreaterThan(ARCADE_RUNNER.jump.rows * 2)
    expect(low! - HERO_HEIGHT).toBeLessThan(ARCADE_RUNNER.jump.rows * 2)
  })

  it('scores a collected star by its combo, and a missed one breaks the combo', () => {
    const start = { ...runnerStartOf(RUNNER, 1), obstacles: [], nextAt: Number.POSITIVE_INFINITY }
    const reach = HERO_LEFT + 4
    const low = (x: number) => ({ x, h: HERO_HEIGHT - 2 })
    const two = run({ ...start, stars: [low(reach + 1), low(reach + 3)] }, 400)
    expect(two.combo).toBe(2)
    expect(two.score).toBe(Math.floor(two.distance * 0.1) + STAR_POINTS * 3)
    const missed = run({ ...two, stars: [{ x: two.distance + reach + 1, h: 40 }] }, 400)
    expect(missed.combo).toBe(0)
    expect(missed.score - Math.floor(missed.distance * 0.1)).toBe(STAR_POINTS * 3)
  })

  it('sends obstacles in tight bursts more often the farther the run goes', () => {
    const tightShare = (from: number, columns: number) => {
      const base = runnerStartOf(RUNNER, 9)
      let state: RunnerState = {
        ...base,
        distance: from,
        nextAt: from + 40,
        obstacles: [],
        stars: []
      }
      const gaps = new Map<number, number>()
      for (let at = 0; at < columns; at += 100) {
        state = runnerStepOf(RUNNER, state, 0, false)
        const all = state.obstacles
        for (let j = 1; j < all.length; j += 1) {
          gaps.set(all[j]!.x, all[j]!.x - all[j - 1]!.x - widthOf(all[j - 1]!.shape))
        }
        state = { ...state, distance: state.distance + 100 }
      }
      const seen = [...gaps.values()]
      return seen.filter((one) => one < ARCADE_RUNNER.difficulty.minGap).length / seen.length
    }
    expect(tightShare(0, 500)).toBe(0)
    expect(tightShare(4000, 6000)).toBeGreaterThan(0.15)
  })

  it('never runs farther than a short step when a frame comes late', () => {
    const start = runnerStartOf(RUNNER, 1)
    expect(runnerStepOf(RUNNER, start, 60_000, false).distance).toBeLessThan(
      ARCADE_RUNNER.speed.start
    )
  })
})
