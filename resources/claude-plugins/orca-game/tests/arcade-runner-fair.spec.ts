import { describe, expect, it } from 'vitest'

import {
  HERO_HITBOX,
  runnerOf,
  runnerStartOf,
  runnerStepOf,
  type Runner,
  type RunnerState
} from '../hooks/arcade-runner'
import { courseGroupOf, runnerLevelOf, RUNNER_LEVEL_MS } from '../hooks/arcade-runner-course'
import { ARCADE_RUNNER } from '../hooks/arcade-runner-data'
import { runnerAirtimeOf } from '../hooks/arcade-runner-jump'
import {
  ARCADE_SHAPE_MAX_COLUMNS,
  ARCADE_SHAPE_MAX_HEIGHT,
  arcadeShapesOf
} from '../hooks/arcade-runner-frame'
import { SCENES } from '../hooks/scenes/index'

// Whether a person can actually clear what the generator spawns: one press, swept over every moment.

const TICK_MS = 1000 / ARCADE_RUNNER.fps
const SWEEP_MS = 5
const MIN_WINDOW_MS = 150
const AHEAD = 40

// Every shape a run can meet: each built-in scene's decoration, the rock, and the largest a scene may be.
const WIDEST = { heights: Array(ARCADE_SHAPE_MAX_COLUMNS).fill(ARCADE_SHAPE_MAX_HEIGHT), weight: 1 }
const SHAPES = [
  WIDEST,
  ...Object.values(SCENES).flatMap((scene) => arcadeShapesOf(ARCADE_RUNNER, scene.looks.working))
]
const RUNNER = runnerOf(ARCADE_RUNNER, SHAPES)
const { start, max, rampPerMinute } = ARCADE_RUNNER.speed
const MS_AT_MAX = ((max - start) / rampPerMinute) * 60_000
const RAMP = [0, MS_AT_MAX / 4, MS_AT_MAX / 2, (3 * MS_AT_MAX) / 4, MS_AT_MAX + 1]

/** One obstacle ahead on an empty road, with the run's clock at `ms`. */
const roadOf = (runner: Runner, shape: number, ms: number): RunnerState => {
  const base = runnerStartOf(runner, 1)
  return { ...base, ms, nextAt: Number.MAX_SAFE_INTEGER, obstacles: [{ x: AHEAD, shape }] }
}

/** Steps at the loop's frame rate, plus the press's own step at `pressMs`; true when it clears. */
const clearsWith = (runner: Runner, road: RunnerState, pressMs: number): boolean => {
  const width = runner.shapes[road.obstacles[0]!.shape]!.heights.length
  let state = road
  let at = 0
  let isPressed = false
  for (let frame = 1; frame < 400 && !state.isOver; frame += 1) {
    const next = frame * TICK_MS
    if (!isPressed && pressMs < next) {
      state = runnerStepOf(runner, state, pressMs - at, true)
      at = pressMs
      isPressed = true
    }
    state = runnerStepOf(runner, state, next - at, false)
    at = next
    if (state.distance + HERO_HITBOX.left > AHEAD + width + 1 && isPressed) {
      return !state.isOver
    }
  }
  return false
}

/** The longest run of press moments, in ms, that clear the obstacle. */
const windowOf = (runner: Runner, road: RunnerState): number => {
  let best = 0
  let run = 0
  for (let pressMs = 0; pressMs < (AHEAD / start) * 1000; pressMs += SWEEP_MS) {
    run = clearsWith(runner, road, pressMs) ? run + SWEEP_MS : 0
    best = Math.max(best, run)
  }
  return best
}

describe('a fair runner', () => {
  it(`leaves at least ${MIN_WINDOW_MS} ms to time a jump over every obstacle, at every speed`, () => {
    const short: string[] = []
    SHAPES.forEach((shape, index) => {
      for (const ms of RAMP) {
        const window = windowOf(RUNNER, roadOf(RUNNER, index, ms))
        if (window < MIN_WINDOW_MS) {
          short.push(`[${shape.heights.join(',')}] at ${Math.round(ms / 1000)} s: ${window} ms`)
        }
      }
    })
    expect(short).toEqual([])
  })

  it('lets a player who misses each moment by 70 ms run past the last level', () => {
    const levels = Math.ceil(MS_AT_MAX / RUNNER_LEVEL_MS) + 1
    for (const seed of [1, 2, 3, 4]) {
      for (const jitterMs of [-70, 0, 70]) {
        const end = playOf(seed, jitterMs, (levels + 1) * RUNNER_LEVEL_MS)
        expect(end.isOver, `seed ${seed} off by ${jitterMs} ms, at ${Math.round(end.ms)} ms`).toBe(
          false
        )
        expect(end.level).toBeGreaterThan(levels)
      }
    }
  })
})

/** A player who aims each jump's peak at an obstacle's middle, `jitterMs` off the moment. */
const playOf = (seed: number, jitterMs: number, playMs: number): RunnerState => {
  let state = runnerStartOf(RUNNER, seed)
  let aimed = -Infinity
  while (state.ms < playMs && !state.isOver) {
    const hero = state.distance + HERO_HITBOX.left + HERO_HITBOX.width / 2
    const next = state.obstacles.find((one) => one.x > aimed && one.x + 2 > hero - 1)
    const width = next === undefined ? 0 : RUNNER.shapes[next.shape]!.heights.length
    const lead = (runnerAirtimeOf(ARCADE_RUNNER, state.speed) * state.speed) / 2000
    const pressMs =
      next === undefined
        ? Infinity
        : ((next.x + width / 2 - hero - lead) / state.speed) * 1000 + jitterMs
    if (next !== undefined && pressMs < TICK_MS) {
      state = runnerStepOf(RUNNER, state, Math.max(0, pressMs), true)
      state = runnerStepOf(RUNNER, state, TICK_MS - Math.max(0, pressMs), false)
      aimed = next.x
    } else {
      state = runnerStepOf(RUNNER, state, TICK_MS, false)
    }
  }
  return state
}

describe('a course', () => {
  const shapes = { shapes: SHAPES, total: RUNNER.totalWeight }
  const groupsAt = (level: number) =>
    Array.from({ length: 300 }, (_, n) =>
      courseGroupOf(ARCADE_RUNNER, shapes, 9, n, 0, (level - 1) * RUNNER_LEVEL_MS)
    )
  const gapOf = (group: ReturnType<typeof courseGroupOf>) => {
    const last = group.obstacles.at(-1)!
    return group.end - last.x - SHAPES[last.shape]!.heights.length
  }

  it('comes as single obstacles at first, then in pairs and threes with closer gaps', () => {
    const first = groupsAt(1)
    const late = groupsAt(8)
    expect(first.every((one) => one.obstacles.length === 1)).toBe(true)
    expect(late.some((one) => one.obstacles.length === 2)).toBe(true)
    expect(late.some((one) => one.obstacles.length === 3)).toBe(true)
    const mean = (all: typeof first) => all.reduce((sum, one) => sum + gapOf(one), 0) / all.length
    expect(mean(late)).toBeLessThan(mean(first) - 5)
    expect(runnerLevelOf(RUNNER_LEVEL_MS * 3 + 1)).toBe(4)
  })

  it('lays coins over some jumps, and high ones only an air jump reaches after the first level', () => {
    const peak = ARCADE_RUNNER.jump.rows * 2
    expect(groupsAt(1).some((one) => one.coins.length > 0)).toBe(true)
    expect(
      groupsAt(1)
        .flatMap((one) => one.coins)
        .every((coin) => coin.h <= peak + 4)
    ).toBe(true)
    expect(groupsAt(3).some((one) => one.coins.some((coin) => coin.h > peak + 8))).toBe(true)
  })
})
