import type { ArcadeRunner } from './arcade-runner-data'

// The hero's flight. The arc stretches with the run's speed, so a jump that clears an obstacle at
// the start still clears it at max: all by time leaves a slow run too short a jump for a wide
// obstacle, all by distance leaves a fast run too short a window to press in.

/** One arc: feet height and upward speed at its take-off (px, px/s), its gravity, and time since. */
export type RunnerAir = { from: number; rise: number; gravity: number; ms: number }

const TIME_SHARE = 0.4
/** The air jump's push as a share of a ground jump's, and the most it may reach, as peaks. */
const AIR_RISE = 0.8
export const RUNNER_CEILING = 1.5
/** A press this close to touchdown takes off again on landing instead of spending the air jump. */
export const JUMP_BUFFER_MS = 120

/** Peak of a ground jump, in pixels: `jump.rows` band rows of two pixels. */
export const runnerPeakOf = (game: ArcadeRunner): number => game.jump.rows * 2

/** Time in the air of a ground jump at `speed`; `jump.ms` at the start speed, less when faster. */
export const runnerAirtimeOf = (game: ArcadeRunner, speed: number): number =>
  game.jump.ms * (TIME_SHARE + ((1 - TIME_SHARE) * game.speed.start) / speed)

export const feetOf = (air: RunnerAir): number => {
  const s = air.ms / 1000
  return Math.max(0, air.from + air.rise * s - (air.gravity * s * s) / 2)
}

/** Whether the arc has come back down to the ground by its `ms`. */
export const isLandedOf = (air: RunnerAir): boolean =>
  air.ms > 0 &&
  air.from + (air.rise * air.ms) / 1000 - (air.gravity * (air.ms / 1000) ** 2) / 2 <= 0

export const msToLandOf = (air: RunnerAir): number => {
  const total = (air.rise + Math.sqrt(air.rise ** 2 + 2 * air.gravity * air.from)) / air.gravity
  return Math.max(0, total * 1000 - air.ms)
}

/** A new arc from `from` pixels up: a full jump off the ground, a weaker one in the air. */
export const launchOf = (game: ArcadeRunner, speed: number, from: number): RunnerAir => {
  const seconds = runnerAirtimeOf(game, speed) / 1000
  const peak = runnerPeakOf(game)
  const gravity = (8 * peak) / seconds ** 2
  const full = (4 * peak) / seconds
  if (from <= 0) {
    return { from: 0, rise: full, gravity, ms: 0 }
  }
  const room = Math.max(0, RUNNER_CEILING * peak - from)
  return { from, rise: Math.min(full * AIR_RISE, Math.sqrt(2 * gravity * room)), gravity, ms: 0 }
}
