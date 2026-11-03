import type { Runner, RunnerState } from './arcade-runner'
import { HERO_HEIGHT, HERO_HITBOX, jumpSpanOf, peakOf } from './arcade-runner-hero'
import { hash } from './pixel-canvas'

// What lies ahead of the hero: obstacles at seeded gaps, tight bursts that grow more common as the
// run goes on, and stars to pick up in the air.

/** `x` is the world column of the obstacle's left edge; the screen shows `distance` onwards. */
export type RunnerObstacle = { x: number; shape: number }
/** A star's world column and its height above the ground in pixels. */
export type RunnerStar = { x: number; h: number }

export type RunnerCourse = {
  obstacles: readonly RunnerObstacle[]
  stars: readonly RunnerStar[]
  /** World column the next obstacle spawns at, how many have spawned, tight gaps still due. */
  nextAt: number
  spawned: number
  burst: number
}

// Why: the widest band (160 columns at 1440 px) never shows an obstacle pop in.
const HORIZON = 200
// Why: no burst in the first ~40 s at the start speed, then one more percent every 50 columns.
const BURST_FROM = 600
const BURST_COLUMNS_PER_PERCENT = 50
const BURST_MAX_PERCENT = 40
/** Ground time between landing from one obstacle of a burst and the take-off for the next. */
const BURST_REST_MS = 150
const STAR_PERCENT = 35
const HIGH_STAR_PERCENT = 40
const HIGH_STAR_MIN_GAP = 30

/** Low stars sit near a single jump's peak; high ones only a double jump reaches. */
export const starHeightsOf = (runner: Runner): { low: number; high: number } => ({
  low: HERO_HEIGHT + peakOf(runner.game) - 2,
  high: HERO_HEIGHT + peakOf(runner.game) + 3
})

const widthOf = (runner: Runner, shape: number): number => runner.shapes[shape]?.heights.length ?? 0

// Why its own seed: the shape and gap draws already use hash(seed, n * 2) and n * 2 + 1.
const roll = (seed: number, n: number, salt: number): number =>
  hash(seed ^ 0x5f3759df, n * 8 + salt) % 100

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

/**
 * The gap a burst leaves after an obstacle `width` wide at world column `x`: a jump centred on
 * each obstacle, with BURST_REST_MS on the ground between them, at the speed the hero gets there.
 */
const tightGapOf = (runner: Runner, state: RunnerState, x: number, width: number): number => {
  const { max, rampPerMinute } = runner.game.speed
  const speed = Math.min(
    max,
    state.speed + (rampPerMinute * (x - state.distance)) / state.speed / 60
  )
  const span = jumpSpanOf(runner.game, runner.shapes, speed)
  const narrowest = Math.min(...runner.shapes.map((one) => one.heights.length))
  const crossings = width + narrowest + 2 * HERO_HITBOX.width
  return Math.ceil(span - crossings / 2 + HERO_HITBOX.width + (speed * BURST_REST_MS) / 1000)
}

const burstPercentOf = (x: number): number =>
  Math.min(BURST_MAX_PERCENT, Math.max(0, Math.floor((x - BURST_FROM) / BURST_COLUMNS_PER_PERCENT)))

/** The course with what has gone behind the hero dropped and the horizon filled. */
export const courseOf = (runner: Runner, state: RunnerState): RunnerCourse => {
  const { minGap, maxGap } = runner.game.difficulty
  const { seed } = state
  const obstacles = state.obstacles.filter(
    (one) => one.x + widthOf(runner, one.shape) > state.distance
  )
  const stars = [...state.stars]
  let { nextAt, spawned, burst } = state
  const { low, high } = starHeightsOf(runner)
  while (nextAt < state.distance + HORIZON && runner.shapes.length > 0) {
    const shape = pickShapeOf(runner, seed, spawned)
    const width = widthOf(runner, shape)
    obstacles.push({ x: nextAt, shape })
    if (roll(seed, spawned, 2) < STAR_PERCENT) {
      stars.push({ x: nextAt + Math.floor(width / 2), h: low })
    }
    let gap: number
    if (burst > 0 || roll(seed, spawned, 3) < burstPercentOf(nextAt)) {
      burst = burst > 0 ? burst - 1 : roll(seed, spawned, 4) % 2
      gap = Math.min(
        minGap,
        tightGapOf(runner, state, nextAt, width) + (roll(seed, spawned, 5) % 3)
      )
    } else {
      gap = minGap + (hash(seed, spawned * 2) % (maxGap - minGap + 1))
      if (gap >= HIGH_STAR_MIN_GAP && roll(seed, spawned, 6) < HIGH_STAR_PERCENT) {
        stars.push({ x: nextAt + width + Math.floor(gap / 2), h: high })
      }
    }
    nextAt += width + gap
    spawned += 1
  }
  return { obstacles, stars, nextAt, spawned, burst }
}
