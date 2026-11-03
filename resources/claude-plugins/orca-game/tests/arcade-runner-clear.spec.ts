import { describe, expect, it } from 'vitest'

import {
  HERO_HITBOX,
  runnerOf,
  runnerStartOf,
  runnerStepOf,
  type Runner,
  type RunnerShape,
  type RunnerState
} from '../hooks/arcade-runner'
import { ARCADE_RUNNER } from '../hooks/arcade-runner-data'
import {
  ARCADE_SHAPE_MAX_COLUMNS,
  ARCADE_SHAPE_MAX_HEIGHT,
  arcadeShapesOf
} from '../hooks/arcade-runner-frame'
import { SCENES } from '../hooks/scenes/index'

// Every obstacle the built-in runner can spawn must leave a real window to press in, at every speed.

const PRESS_WINDOW_MS = 150
const SWEEP_STEP_MS = 5
const BOX: RunnerShape = {
  heights: Array(ARCADE_SHAPE_MAX_COLUMNS).fill(ARCADE_SHAPE_MAX_HEIGHT),
  weight: 1
}
const { start, max, rampPerMinute } = ARCADE_RUNNER.speed
const SPEEDS = [start, (start + max) / 2, max]

const builtInShapes = () => {
  const all = Object.values(SCENES).flatMap((scene) =>
    Object.values(scene.looks).flatMap((look) => arcadeShapesOf(ARCADE_RUNNER, look))
  )
  const byHeights = new Map([BOX, ...all].map((one) => [one.heights.join(), one]))
  return [...byHeights.values()]
}

/** One obstacle `ahead` columns past the hero, nothing else, at `speed`. */
const lonelyOf = (runner: Runner, speed: number, ahead: number): RunnerState => {
  const base = runnerStartOf(runner, 1)
  const ms = ((speed - start) / rampPerMinute) * 60_000
  return {
    ...base,
    ms,
    speed,
    obstacles: [{ x: ahead, shape: 0 }],
    stars: [],
    nextAt: Number.POSITIVE_INFINITY
  }
}

/** The longest run of press times, in ms, that clear the obstacle, frames ticking at `fps`. */
const pressWindowOf = (shape: RunnerShape, speed: number, fps: number) => {
  const runner = runnerOf(ARCADE_RUNNER, [shape])
  const frameMs = 1000 / fps
  const ahead = 30 + HERO_HITBOX.left
  const passed = ahead + shape.heights.length
  let frame = lonelyOf(runner, speed, ahead)
  let frameAt = 0
  let best = 0
  let run = 0
  for (let press = 0; press * speed < 40_000 && !frame.isOver; press += SWEEP_STEP_MS) {
    while (press >= frameAt + frameMs) {
      frame = runnerStepOf(runner, frame, frameMs, false)
      frameAt += frameMs
    }
    const before = runnerStepOf(runner, frame, press - frameAt, false)
    let after = runnerStepOf(runner, before, frameAt + frameMs - press, true)
    while (after.air !== undefined && !after.isOver) {
      after = runnerStepOf(runner, after, frameMs, false)
    }
    const isClear = !after.isOver && after.distance + HERO_HITBOX.left > passed
    run = isClear ? run + SWEEP_STEP_MS : 0
    best = Math.max(best, run)
  }
  return best
}

describe("the runner's jump", () => {
  it('clears every obstacle the game spawns with a press window of 150 ms, from start to max speed', () => {
    const shapes = builtInShapes()
    for (const fps of [ARCADE_RUNNER.fps, 15]) {
      for (const speed of SPEEDS) {
        for (const shape of shapes) {
          const label = `${shape.heights.join(',')} at ${speed} col/s, ${fps} fps`
          expect(pressWindowOf(shape, speed, fps), label).toBeGreaterThanOrEqual(PRESS_WINDOW_MS)
        }
      }
    }
  })

  it('is easiest at the start speed, not hardest', () => {
    expect(pressWindowOf(BOX, start, 12)).toBeGreaterThanOrEqual(pressWindowOf(BOX, max, 12))
  })
})

const widthOf = (runner: Runner, one: { shape: number }) =>
  runner.shapes[one.shape]?.heights.length ?? 0

const landedOf = (runner: Runner, state: RunnerState, frameMs: number) => {
  let at = state
  while (at.air !== undefined && !at.isOver) {
    at = runnerStepOf(runner, at, frameMs, false)
  }
  return at
}

/** A player who presses once per obstacle, in the middle of the frames that would clear it. */
const playedOf = (runner: Runner, seed: number, ms: number, fps: number): RunnerState => {
  const frameMs = 1000 / fps
  let state = runnerStartOf(runner, seed)
  let planned: number | undefined
  for (let frame = 0; frame * frameMs < ms && !state.isOver; frame += 1) {
    const target = state.obstacles.find(
      (one) => one.x + widthOf(runner, one) > state.distance + HERO_HITBOX.left
    )
    if (planned === undefined && state.air === undefined && target !== undefined) {
      const passed = target.x + widthOf(runner, target)
      const clears: number[] = []
      let ahead = state
      for (let wait = 0; wait < 3 * fps && !ahead.isOver; wait += 1) {
        const jumped = landedOf(runner, runnerStepOf(runner, ahead, frameMs, true), frameMs)
        if (!jumped.isOver && jumped.distance + HERO_HITBOX.left > passed) {
          clears.push(wait)
        } else if (clears.length > 0) {
          break
        }
        ahead = runnerStepOf(runner, ahead, frameMs, false)
      }
      planned = clears.length === 0 ? undefined : frame + clears[Math.floor(clears.length / 2)]!
    }
    const isPress = planned === frame
    if (isPress) {
      planned = undefined
    }
    state = runnerStepOf(runner, state, frameMs, isPress)
    if (state.air !== undefined) {
      planned = undefined
    }
  }
  return state
}

describe('a whole run', () => {
  it('can be played from the start speed past the max with one well-timed press per obstacle', () => {
    const shapes = builtInShapes()
    const runner = runnerOf(ARCADE_RUNNER, shapes)
    const toMax = ((max - start) / rampPerMinute) * 60_000
    for (const seed of [1, 2, 3]) {
      const end = playedOf(runner, seed, toMax + 20_000, ARCADE_RUNNER.fps)
      expect(end.isOver, `seed ${seed} at ${Math.round(end.distance)}`).toBe(false)
      expect(end.speed).toBe(max)
    }
  }, 60_000)
})
