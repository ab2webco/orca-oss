import type { ArcadeRunner } from './arcade-runner-data'
import { courseOf, type RunnerCourse } from './arcade-runner-course'
import {
  airHeightOf,
  airStepOf,
  BUFFER_MS,
  HERO_HEIGHT,
  HERO_HITBOX,
  HERO_REACH,
  jumpSpanOf,
  takeOffOf,
  type RunnerAir
} from './arcade-runner-hero'

export { HERO_HEIGHT, HERO_HITBOX, HERO_LEFT } from './arcade-runner-hero'
export type { RunnerAir } from './arcade-runner-hero'
export type { RunnerObstacle, RunnerStar } from './arcade-runner-course'

// The runner's rules, apart from its drawing: time-based, seeded, and the same on every surface.

/** An obstacle's height in pixels above the ground, one per column; `weight` is how often it comes. */
export type RunnerShape = { heights: readonly number[]; weight: number }

export type Runner<S extends RunnerShape = RunnerShape> = {
  game: ArcadeRunner
  shapes: readonly S[]
  totalWeight: number
}

export type RunnerState = RunnerCourse & {
  seed: number
  ms: number
  distance: number
  speed: number
  /** The jump in progress; undefined on the ground. */
  air: RunnerAir | undefined
  /** Time since a press that found both jumps spent: it takes off on landing within BUFFER_MS. */
  queuedMs: number | undefined
  /** Stars picked up in a row, and the points they brought. */
  combo: number
  bonus: number
  score: number
  isOver: boolean
}

export const STAR_POINTS = 5
const FIRST_GAP = 40
// Why: a frame that comes seconds late (a stalled host) must not jump the hero past an obstacle.
const MAX_STEP_MS = 100
// Why: hits and pickups are checked this often, so a frame rate never lets the hero clip through.
const SUB_STEP_MS = 10
const POINTS_PER_COLUMN = 0.1

export const runnerOf = <S extends RunnerShape>(
  game: ArcadeRunner,
  shapes: readonly S[]
): Runner<S> => ({
  game,
  shapes,
  totalWeight: shapes.reduce((sum, one) => sum + one.weight, 0)
})

const withCourse = (runner: Runner, state: RunnerState): RunnerState => ({
  ...state,
  ...courseOf(runner, state)
})

export const runnerStartOf = (runner: Runner, seed: number): RunnerState =>
  withCourse(runner, {
    seed,
    ms: 0,
    distance: 0,
    speed: runner.game.speed.start,
    air: undefined,
    queuedMs: undefined,
    obstacles: [],
    stars: [],
    nextAt: FIRST_GAP,
    spawned: 0,
    burst: 0,
    combo: 0,
    bonus: 0,
    score: 0,
    isOver: false
  })

/** The hero's feet above the ground, in pixels. */
export const runnerHeightOf = (_runner: Runner, state: RunnerState): number =>
  state.air === undefined ? 0 : airHeightOf(state.air)

const takeOff = (runner: Runner, state: RunnerState): RunnerAir | undefined =>
  takeOffOf(
    runner.game,
    jumpSpanOf(runner.game, runner.shapes, state.speed),
    state.speed,
    state.air
  )

const isHitOf = (runner: Runner, state: RunnerState): boolean => {
  const feet = runnerHeightOf(runner, state)
  const left = state.distance + HERO_HITBOX.left
  return state.obstacles.some((one) => {
    const heights = runner.shapes[one.shape]?.heights ?? []
    return heights.some((height, column) => {
      const x = one.x + column
      return x + 1 > left && x < left + HERO_HITBOX.width && feet < height
    })
  })
}

/** Stars the hero touches add to the combo; one that slips past behind it ends the combo. */
const pickedOf = (runner: Runner, state: RunnerState): RunnerState => {
  const feet = runnerHeightOf(runner, state)
  const left = state.distance + HERO_REACH.left
  let { combo, bonus } = state
  const stars = state.stars.filter((one) => {
    const above = one.h - feet
    if (
      one.x + 1 > left &&
      one.x < left + HERO_REACH.width &&
      above >= -1 &&
      above <= HERO_HEIGHT
    ) {
      combo += 1
      bonus += STAR_POINTS * combo
      return false
    }
    if (one.x + 1 <= left) {
      combo = 0
      return false
    }
    return true
  })
  return stars.length === state.stars.length ? state : { ...state, stars, combo, bonus }
}

const movedOf = (runner: Runner, state: RunnerState, dt: number): RunnerState => {
  const { start, max, rampPerMinute } = runner.game.speed
  const ms = state.ms + dt
  const speed = Math.min(max, start + (rampPerMinute * ms) / 60_000)
  const distance = state.distance + (speed * dt) / 1000
  const queued = state.queuedMs === undefined ? undefined : state.queuedMs + dt
  const queuedMs = queued !== undefined && queued <= BUFFER_MS ? queued : undefined
  let air = state.air === undefined ? undefined : airStepOf(state.air, dt)
  let next: RunnerState = { ...state, ms, speed, distance, air, queuedMs }
  if (state.air !== undefined && air === undefined && queuedMs !== undefined) {
    air = takeOff(runner, next)
    next = { ...next, air, queuedMs: undefined }
  }
  const picked = pickedOf(runner, withCourse(runner, next))
  const scored = {
    ...picked,
    score: Math.floor(distance * POINTS_PER_COLUMN) + picked.bonus
  }
  return isHitOf(runner, scored) ? { ...scored, isOver: true } : scored
}

/** A press: a jump from the ground, the double jump, or a jump held for the landing. */
const pressedOf = (runner: Runner, state: RunnerState): RunnerState => {
  const air = takeOff(runner, state)
  return air === undefined ? { ...state, queuedMs: 0 } : { ...state, air, queuedMs: undefined }
}

/** `isJump`: the key came just before this step, so the hero is in the air all of it. */
export const runnerStepOf = (
  runner: Runner,
  state: RunnerState,
  dtMs: number,
  isJump: boolean
): RunnerState => {
  if (state.isOver) {
    return state
  }
  let at = isJump ? pressedOf(runner, state) : state
  let left = Math.max(0, Math.min(MAX_STEP_MS, dtMs))
  do {
    const dt = Math.min(SUB_STEP_MS, left)
    at = movedOf(runner, at, dt)
    left -= dt
  } while (left > 0 && !at.isOver)
  return at
}
