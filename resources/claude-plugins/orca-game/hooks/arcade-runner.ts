import type { ArcadeRunner } from './arcade-runner-data'
import { hash } from './pixel-canvas'

// The runner's rules, apart from its drawing: time-based, seeded, and the same on every surface.

/** An obstacle's height in pixels above the ground, one per column; `weight` is how often it comes. */
export type RunnerShape = { heights: readonly number[]; weight: number }

export type Runner = { game: ArcadeRunner; shapes: readonly RunnerShape[]; totalWeight: number }

/** `x` is the world column of the obstacle's left edge; the screen shows `distance` onwards. */
export type RunnerObstacle = { x: number; shape: number }

export type RunnerState = {
  seed: number
  ms: number
  distance: number
  speed: number
  /** Time since take-off; undefined on the ground. */
  jumpMs: number | undefined
  obstacles: readonly RunnerObstacle[]
  /** World column the next obstacle spawns at, and how many have spawned. */
  nextAt: number
  spawned: number
  score: number
  isOver: boolean
}

/** Screen columns the hero's feet hit with: the middle legs of its outlined costume. */
export const HERO_LEFT = 2
// Why narrower than the legs: at max speed a 4-px obstacle then leaves about ±85 ms to time a jump.
export const HERO_HITBOX = { left: HERO_LEFT + 4, width: 3 }
// Why: the widest band (160 columns at 1440 px) never shows an obstacle pop in.
const HORIZON = 200
const FIRST_GAP = 40
// Why: a frame that comes seconds late (a stalled host) must not jump the hero past an obstacle.
const MAX_STEP_MS = 100
const POINTS_PER_COLUMN = 0.1

export const runnerOf = (game: ArcadeRunner, shapes: readonly RunnerShape[]): Runner => ({
  game,
  shapes,
  totalWeight: shapes.reduce((sum, one) => sum + one.weight, 0)
})

const shapeWidthOf = (runner: Runner, shape: number): number =>
  runner.shapes[shape]?.heights.length ?? 0

const pickShapeOf = (runner: Runner, seed: number, n: number): number => {
  let left = (hash(seed, n * 2 + 1) / 0x100000000) * runner.totalWeight
  for (let i = 0; i < runner.shapes.length; i += 1) {
    left -= runner.shapes[i]?.weight ?? 0
    if (left < 0) {
      return i
    }
  }
  return runner.shapes.length - 1
}

const spawnedOf = (runner: Runner, state: RunnerState): RunnerState => {
  const { minGap, maxGap } = runner.game.difficulty
  const obstacles = state.obstacles.filter(
    (one) => one.x + shapeWidthOf(runner, one.shape) > state.distance
  )
  let { nextAt, spawned } = state
  while (nextAt < state.distance + HORIZON && runner.shapes.length > 0) {
    const shape = pickShapeOf(runner, state.seed, spawned)
    obstacles.push({ x: nextAt, shape })
    nextAt +=
      shapeWidthOf(runner, shape) + minGap + (hash(state.seed, spawned * 2) % (maxGap - minGap + 1))
    spawned += 1
  }
  return { ...state, obstacles, nextAt, spawned }
}

export const runnerStartOf = (runner: Runner, seed: number): RunnerState =>
  spawnedOf(runner, {
    seed,
    ms: 0,
    distance: 0,
    speed: runner.game.speed.start,
    jumpMs: undefined,
    obstacles: [],
    nextAt: FIRST_GAP,
    spawned: 0,
    score: 0,
    isOver: false
  })

/** The hero's feet above the ground, in pixels: a parabola that peaks at `jump.rows` band rows. */
export const runnerHeightOf = (runner: Runner, state: RunnerState): number => {
  if (state.jumpMs === undefined) {
    return 0
  }
  const t = state.jumpMs / runner.game.jump.ms
  return t >= 1 ? 0 : runner.game.jump.rows * 2 * 4 * t * (1 - t)
}

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

export const runnerStepOf = (
  runner: Runner,
  state: RunnerState,
  dtMs: number,
  isJump: boolean
): RunnerState => {
  if (state.isOver) {
    return state
  }
  const dt = Math.min(MAX_STEP_MS, dtMs)
  const { start, max, rampPerMinute } = runner.game.speed
  const ms = state.ms + dt
  const speed = Math.min(max, start + (rampPerMinute * ms) / 60_000)
  const distance = state.distance + (speed * dt) / 1000
  const aired = state.jumpMs === undefined ? undefined : state.jumpMs + dt
  const landed = aired === undefined || aired >= runner.game.jump.ms ? undefined : aired
  // Why dt: the key came before this step, so the hero has been in the air all of it.
  const jumpMs = isJump && state.jumpMs === undefined ? dt : landed
  const moved = spawnedOf(runner, { ...state, ms, speed, distance, jumpMs })
  const scored = { ...moved, score: Math.floor(distance * POINTS_PER_COLUMN) }
  return isHitOf(runner, scored) ? { ...scored, isOver: true } : scored
}
