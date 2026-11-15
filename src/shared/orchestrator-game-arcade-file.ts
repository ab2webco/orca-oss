import { z } from 'zod'
import { color, localizedSceneName, uncoloredGlyphOf } from './orchestrator-game-scene-values'
import runnerData from './orchestrator-game-arcade-runner.json'
import snakeData from './orchestrator-game-arcade-snake.json'

/** A game the arcade offers after a perfect merge: inert data one of the game's built-in engines plays. */

export const ORCHESTRATOR_GAME_ARCADE_ENGINES = ['runner', 'snake'] as const
export type OrchestratorGameArcadeEngine = (typeof ORCHESTRATOR_GAME_ARCADE_ENGINES)[number]

/** One of the built-in games for `roll` in [0, 1). */
export const pickOrchestratorGameArcadeEngine = (roll: number): OrchestratorGameArcadeEngine =>
  ORCHESTRATOR_GAME_ARCADE_ENGINES[
    Math.min(
      ORCHESTRATOR_GAME_ARCADE_ENGINES.length - 1,
      Math.max(0, Math.floor(roll * ORCHESTRATOR_GAME_ARCADE_ENGINES.length))
    )
  ]
export const ORCHESTRATOR_GAME_ARCADE_MAX_BYTES = 16 * 1024
// Why 15: the scene already repaints every 120 ms; past ~15 fps a terminal Raster drops frames.
export const ORCHESTRATOR_GAME_ARCADE_FPS_MIN = 5
export const ORCHESTRATOR_GAME_ARCADE_FPS_MAX = 15
// Why: an obstacle stands on the ground below a hero that is seven rows tall and jumps over it.
const OBSTACLE_MAX_ROWS = 6
const OBSTACLE_MAX_COLUMNS = 6
const OBSTACLES_MAX = 8

const fpsError = `must be a whole number from ${ORCHESTRATOR_GAME_ARCADE_FPS_MIN} to ${ORCHESTRATOR_GAME_ARCADE_FPS_MAX}`
const bounded = (min: number, max: number) => {
  const error = `must be from ${min} to ${max}`
  return z.number({ error }).min(min, error).max(max, error)
}
const weight = bounded(0.05, 1).default(1)

const spriteRow = z
  .string()
  .regex(
    new RegExp(`^[!-~]{1,${OBSTACLE_MAX_COLUMNS}}$`),
    `must be one to ${OBSTACLE_MAX_COLUMNS} printable ASCII glyphs`
  )
const spriteObstacleSchema = z
  .object({
    rows: z
      .array(spriteRow)
      .min(1)
      .max(OBSTACLE_MAX_ROWS)
      .refine(
        (rows) => rows.every((row) => row.length === rows[0]?.length),
        'every row must be the same width'
      ),
    colors: z.record(z.string().regex(/^[!-~]$/), color),
    weight
  })
  .superRefine((sprite, ctx) => {
    const missing = uncoloredGlyphOf(sprite.rows, sprite.colors)
    if (missing !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['colors'], message: `glyph "${missing}" has no color` })
    }
  })
// Why `from: scene`: the active scene's ground decoration (cactus, crystal…) restyles the game for free.
const sceneObstacleSchema = z.object({ from: z.literal('scene'), weight })
const obstacleSchema = z.union([sceneObstacleSchema, spriteObstacleSchema])

const themeSchema = z
  .object({
    skyTop: color,
    skyBottom: color,
    sun: color,
    far: color,
    snow: color,
    near: color,
    ground: color,
    plant: color,
    cloud: color
  })
  .partial()
  .refine(
    (look) => Object.values(look).some((one) => one !== undefined),
    'must set at least one look color'
  )

const atLeast = (low: string, high: string) => ({
  path: [high],
  message: `must be at least ${low}`
})

const engineError = `must be one of: ${ORCHESTRATOR_GAME_ARCADE_ENGINES.join(', ')}`
const fps = z
  .number({ error: fpsError })
  .int(fpsError)
  .min(ORCHESTRATOR_GAME_ARCADE_FPS_MIN, fpsError)
  .max(ORCHESTRATOR_GAME_ARCADE_FPS_MAX, fpsError)
const whole = (min: number, max: number) => {
  const error = `must be a whole number from ${min} to ${max}`
  return z.number({ error }).int(error).min(min, error).max(max, error)
}

// Why not strict: a game written for a newer Orca keeps working on an older one.
const runnerFileSchema = z.object({
  engine: z.literal('runner', { error: engineError }),
  name: localizedSceneName,
  fps,
  /** Columns per second; the run speeds up by `rampPerMinute` until `max`. */
  speed: z
    .object({ start: bounded(2, 40), max: bounded(2, 40), rampPerMinute: bounded(0, 20) })
    .refine((speed) => speed.max >= speed.start, atLeast('speed.start', 'max')),
  /** Columns of ground between two obstacles, picked at random in this range. */
  difficulty: z
    .object({ minGap: bounded(8, 120), maxGap: bounded(8, 120) })
    .refine((gaps) => gaps.maxGap >= gaps.minGap, atLeast('difficulty.minGap', 'maxGap')),
  jump: z.object({ rows: bounded(2, 8), ms: bounded(200, 2000) }),
  obstacles: z
    .array(obstacleSchema)
    .min(1)
    .max(OBSTACLES_MAX)
    .refine(
      (all) => all.some((one) => 'rows' in one),
      'needs at least one sprite obstacle for scenes with no ground decoration'
    ),
  /** Look colors over the active scene's; left out, the game wears the scene as it is. */
  theme: themeSchema.optional()
})

/** Eat, grow, and keep off the walls and your own tail, on a board of `grid` cells. */
const snakeFileSchema = z.object({
  engine: z.literal('snake', { error: engineError }),
  name: localizedSceneName,
  fps,
  grid: z.object({ columns: whole(12, 40), rows: whole(8, 30) }),
  /** Cells per second; each food eaten adds `rampPerFood` until `max`. */
  speed: z
    .object({ start: bounded(2, 20), max: bounded(2, 20), rampPerFood: bounded(0, 2) })
    .refine((speed) => speed.max >= speed.start, atLeast('speed.start', 'max')),
  start: z.object({ length: whole(2, 8) }),
  food: z.object({ points: whole(1, 50), growth: whole(1, 5) }),
  colors: z.object({ head: color, body: color, food: color })
})

export type OrchestratorGameArcadeRunner = z.infer<typeof runnerFileSchema>
export type OrchestratorGameArcadeSnake = z.infer<typeof snakeFileSchema>
export type OrchestratorGameArcade = OrchestratorGameArcadeRunner | OrchestratorGameArcadeSnake

// Why not a discriminated union: a bad engine still lists every other problem, as a runner's.
const schemaOf = (raw: unknown) =>
  typeof raw === 'object' && raw !== null && (raw as { engine?: unknown }).engine === 'snake'
    ? snakeFileSchema
    : runnerFileSchema

/** The runner every scene can play: the scene's own decoration plus a rock for scenes without one. */
export const ORCHESTRATOR_GAME_ARCADE_RUNNER = `${JSON.stringify(runnerData, null, 2)}\n`

/** The snake every scene can play on the runner's backdrop. */
export const ORCHESTRATOR_GAME_ARCADE_SNAKE = `${JSON.stringify(snakeData, null, 2)}\n`

type ArcadeRead = { ok: true; raw: unknown } | { ok: false; issue: string }

function readArcade(text: string): ArcadeRead {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > ORCHESTRATOR_GAME_ARCADE_MAX_BYTES) {
    return { ok: false, issue: `larger than ${ORCHESTRATOR_GAME_ARCADE_MAX_BYTES / 1024} KB` }
  }
  try {
    return { ok: true, raw: JSON.parse(text) }
  } catch {
    return { ok: false, issue: 'not valid JSON' }
  }
}

/** Every reason the game would refuse `text`, each as `path: message`; empty when valid. */
export function orchestratorGameArcadeIssues(text: string): string[] {
  const read = readArcade(text)
  if (!read.ok) {
    return [read.issue]
  }
  const parsed = schemaOf(read.raw).safeParse(read.raw)
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
}

export function parseOrchestratorGameArcade(
  text: string
): { ok: true; game: OrchestratorGameArcade } | { ok: false; error: string } {
  const read = readArcade(text)
  if (!read.ok) {
    return { ok: false, error: read.issue }
  }
  const parsed = schemaOf(read.raw).safeParse(read.raw)
  if (parsed.success) {
    return { ok: true, game: parsed.data }
  }
  const issue = parsed.error.issues[0]
  return {
    ok: false,
    error: `${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid game'}`
  }
}
