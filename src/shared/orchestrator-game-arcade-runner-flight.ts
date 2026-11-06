import type { OrchestratorGameArcade } from './orchestrator-game-arcade-file'

// The runner's flight and course, ported from the mod's arcade-runner-jump.ts and
// arcade-runner-course.ts so Orca's panel plays the same game; the mod's copy goes with ORCA-1055.

/** What the rules read of a game file. */
export type RunnerGame = Pick<OrchestratorGameArcade, 'speed' | 'difficulty' | 'jump'>

// Why its own copy: the mod's pixel-canvas hash is not importable from src.
const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

// The hero's flight. The arc stretches with the run's speed, so a jump that clears an obstacle at
// the start still clears it at max: all by time leaves a slow run too short a jump for a wide
// obstacle, all by distance leaves a fast run too short a window to press in.

/** One arc: feet height and upward speed at its take-off (px, px/s), its gravity, and time since. */
export type RunnerAir = { from: number; rise: number; gravity: number; ms: number }

const TIME_SHARE = 0.4
/** The air jump's push as a share of a ground jump's, and the most it may reach, as peaks. */
const AIR_RISE = 0.8
export const RUNNER_CEILING = 1.25
/** A press this close to touchdown takes off again on landing instead of spending the air jump. */
export const JUMP_BUFFER_MS = 120

/** Peak of a ground jump, in pixels: `jump.rows` band rows of two pixels. */
export const runnerPeakOf = (game: RunnerGame): number => game.jump.rows * 2

/** Time in the air of a ground jump at `speed`; `jump.ms` at the start speed, less when faster. */
export const runnerAirtimeOf = (game: RunnerGame, speed: number): number =>
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
export const launchOf = (game: RunnerGame, speed: number, from: number): RunnerAir => {
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

// What lies ahead of the hero, spawned a group at a time from the run's seed: one obstacle, or a
// pair or three a bounce apart, and coins over a jump or high in a gap for an air jump to reach.
// Each level the run goes faster, the gaps close in and groups come more often.

/** `x` is the world column of the obstacle's left edge; the screen shows `distance` onwards. */
export type RunnerObstacle = { x: number; shape: number }
/** A coin at world column `x`, `h` pixels above the ground. */
export type RunnerCoin = { x: number; h: number }

export const RUNNER_LEVEL_MS = 20_000
/** How tall the hero stands, for what it can pick up. */
export const HERO_BODY = 8
// Why: the hero needs its landing and a stride or two to time the next jump.
const BOUNCE_ROOM = 6
const SALTS = 8

export const runnerLevelOf = (ms: number): number => 1 + Math.floor(ms / RUNNER_LEVEL_MS)

/** Steps up once a level, so a person feels each one. */
export const runnerSpeedAtOf = (game: RunnerGame, ms: number): number => {
  const { start, max, rampPerMinute } = game.speed
  const reached = ((runnerLevelOf(ms) - 1) * RUNNER_LEVEL_MS) / 60_000
  return Math.min(max, start + rampPerMinute * reached)
}

type Shapes = { shapes: readonly { heights: readonly number[]; weight: number }[]; total: number }

const pickShapeOf = ({ shapes, total }: Shapes, roll: number): number => {
  let left = roll * total
  for (let i = 0; i < shapes.length; i += 1) {
    left -= shapes[i]?.weight ?? 0
    if (left < 0) {
      return i
    }
  }
  return shapes.length - 1
}

export type CourseGroup = {
  obstacles: RunnerObstacle[]
  coins: RunnerCoin[]
  /** World column the next group starts at. */
  end: number
}

/** Group `n` of a run, starting at column `at` and reached `ms` into it. */
export const courseGroupOf = (
  game: RunnerGame,
  shapes: Shapes,
  seed: number,
  n: number,
  at: number,
  ms: number
): CourseGroup => {
  const roll = (salt: number) => hash(seed, n * SALTS + salt) / 0x100000000
  const level = runnerLevelOf(ms)
  const speed = runnerSpeedAtOf(game, ms)
  const span = (runnerAirtimeOf(game, speed) * speed) / 1000
  const { minGap, maxGap } = game.difficulty
  const pairs = Math.min(0.45, 0.12 * (level - 1))
  const triples = level < 4 ? 0 : Math.min(0.2, 0.05 * (level - 3))
  const kind = roll(0)
  const count = kind < triples ? 3 : kind < triples + pairs ? 2 : 1
  const bounce = Math.min(maxGap, Math.max(minGap, Math.ceil(span) + BOUNCE_ROOM))
  const obstacles: RunnerObstacle[] = []
  let x = at
  for (let i = 0; i < count; i += 1) {
    const shape = pickShapeOf(shapes, roll(1 + i))
    obstacles.push({ x, shape })
    x += (shapes.shapes[shape]?.heights.length ?? 0) + (i < count - 1 ? bounce : 0)
  }
  const tighten = Math.min(0.6, 0.1 * (level - 1))
  const high = Math.max(minGap, Math.round(maxGap - (maxGap - minGap) * tighten))
  const gap = minGap + Math.floor(roll(4) * (high - minGap + 1))
  const coins: RunnerCoin[] = []
  const peak = runnerPeakOf(game)
  if (count === 1 && roll(5) < 0.35) {
    // Along a jump centred on the obstacle, at the hero's chest.
    const middle = (at + x) / 2
    for (const dx of [-2, 0, 2]) {
      coins.push({
        x: Math.round(middle + dx),
        h: Math.round(peak * (1 - ((2 * dx) / span) ** 2)) + 3
      })
    }
  }
  if (level > 1 && gap >= 26 && roll(6) < 0.3) {
    // Above where a ground jump's head can reach: only the air jump gets these.
    const middle = x + gap / 2
    for (const dx of [-2, 0, 2]) {
      coins.push({ x: Math.round(middle + dx), h: peak + HERO_BODY })
    }
  }
  return { obstacles, coins, end: x + gap }
}
