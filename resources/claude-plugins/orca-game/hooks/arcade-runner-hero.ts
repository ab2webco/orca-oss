import type { ArcadeRunner } from './arcade-runner-data'

// The hero's body and its jump: a parabola sized in columns from the run's own obstacles, so the
// press window over the hardest one never drops below CLEAR_WINDOW_MS, and widens at slow speeds.

/** Screen columns the hero's feet hit with: the middle legs of its outlined costume. */
export const HERO_LEFT = 2
// Why narrower than the legs: the outline and the far legs read as a near miss, not a hit.
export const HERO_HITBOX = { left: HERO_LEFT + 4, width: 3 }
/** Pixels from the hero's feet to the top of its head: what can touch a star. */
export const HERO_HEIGHT = 9
/** Columns of the hero's body that pick up a star. */
export const HERO_REACH = { left: HERO_LEFT + 2, width: 6 }
// Why 180: a sweep of 5 ms press times must still find 150 ms at 15 fps sub-steps.
export const CLEAR_WINDOW_MS = 180
/** A press this soon before landing, with both jumps spent, takes off again on landing. */
export const BUFFER_MS = 120
// Why 0.8: the second jump rises ~two thirds of a full one, past what a single jump can reach.
const DOUBLE_LIFT = 0.8
/** A double jump tops out at this many single-jump peaks: under the score row of the band. */
const CEILING = 1.5
// Why a floor: an obstacle as tall as the peak would otherwise need an endless jump.
const MIN_RATIO = 0.1

export type RunnerAir = {
  /** Time since this take-off. */
  ms: number
  /** Feet above the ground at take-off, in pixels. */
  from: number
  /** Upward speed at take-off in px/ms, and the pull back down in px/ms². */
  lift: number
  gravity: number
  jumps: 1 | 2
}

export const peakOf = (game: ArcadeRunner): number => game.jump.rows * 2

/**
 * Columns a jump from the ground spans at `speed`: `jump.ms` of travel, or more when an obstacle
 * needs it. The feet stay above `h` for √(1 − h/peak) of a parabola's span, which must cover the
 * obstacle, the hitbox and the press window.
 */
export const jumpSpanOf = (
  game: ArcadeRunner,
  shapes: readonly { heights: readonly number[] }[],
  speed: number
): number => {
  const peak = peakOf(game)
  // Why wider below max: the start of a run is where a player learns the timing.
  const windowMs = CLEAR_WINDOW_MS * Math.sqrt(Math.max(1, game.speed.max / speed))
  return shapes.reduce(
    (span, shape) => {
      const ratio = Math.sqrt(Math.max(MIN_RATIO, 1 - Math.max(0, ...shape.heights) / peak))
      const crossing = shape.heights.length + HERO_HITBOX.width + (speed * windowMs) / 1000
      return Math.max(span, crossing / ratio)
    },
    (game.jump.ms * speed) / 1000
  )
}

export const airHeightOf = (air: RunnerAir): number =>
  Math.max(0, air.from + air.lift * air.ms - (air.gravity * air.ms * air.ms) / 2)

/** A take-off from the ground, or the one double jump; undefined when both are spent. */
export const takeOffOf = (
  game: ArcadeRunner,
  span: number,
  speed: number,
  air: RunnerAir | undefined
): RunnerAir | undefined => {
  const peak = peakOf(game)
  if (air === undefined) {
    const ms = (span / speed) * 1000
    return { ms: 0, from: 0, lift: (4 * peak) / ms, gravity: (8 * peak) / (ms * ms), jumps: 1 }
  }
  if (air.jumps === 2) {
    return undefined
  }
  const from = airHeightOf(air)
  const { gravity } = air
  const full = Math.sqrt(2 * gravity * peak)
  const room = Math.sqrt(2 * gravity * Math.max(0, CEILING * peak - from))
  return { ms: 0, from, lift: Math.min(DOUBLE_LIFT * full, room), gravity, jumps: 2 }
}

/** The air after `dt` more ms, or undefined once the feet are back on the ground. */
export const airStepOf = (air: RunnerAir, dt: number): RunnerAir | undefined => {
  const next = { ...air, ms: air.ms + dt }
  const isFalling = air.lift - air.gravity * next.ms < 0
  return isFalling && airHeightOf(next) <= 0 ? undefined : next
}
