import type { ArcadeRunner } from './arcade-runner-data'
import { runnerAirtimeOf, runnerPeakOf } from './arcade-runner-jump'
import { hash } from './pixel-canvas'

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
export const runnerSpeedAtOf = (game: ArcadeRunner, ms: number): number => {
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
  game: ArcadeRunner,
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
      coins.push({ x: Math.round(middle + dx), h: peak + HERO_BODY + 2 })
    }
  }
  return { obstacles, coins, end: x + gap }
}
