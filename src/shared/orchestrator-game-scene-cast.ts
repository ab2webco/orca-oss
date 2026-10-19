import { z } from 'zod'
import {
  color,
  glyph,
  localizedSceneName,
  uncoloredGlyphOf
} from './orchestrator-game-scene-values'

/** A scene's cast beyond its hero: the pet Pet hearts, and the advisor that acts out Jev's decisions. */

// Mirrors the mod's CAST_MAX_*: a cast member stands under the bubble row, no taller than the hero.
const CAST_MAX_ROWS = 7
const CAST_MAX_FRAMES = 4

const castRow = z.string().regex(/^[!-~]{1,10}$/, 'must be one to ten printable ASCII glyphs')
const isEven = (rows: readonly string[]): boolean =>
  rows.every((row) => row.length === rows[0]?.length)
const castFrame = z
  .array(castRow)
  .min(1)
  .max(CAST_MAX_ROWS)
  .refine(isEven, 'every row of a frame must be the same width')
const framesSchema = z.array(castFrame).min(1).max(CAST_MAX_FRAMES)

const sizeOf = (frame: readonly string[]): string => `${frame[0]?.length ?? 0}x${frame.length}`

type Sprite = { frames: string[][]; extra: string[][]; colors: Record<string, number> }

// Why one size: the game places a cast member by its first frame, so a bigger one would clip.
function spriteIssuesOf(sprite: Sprite): string[] {
  const all = [...sprite.frames, ...sprite.extra]
  const size = sizeOf(sprite.frames[0] ?? [])
  const missing = uncoloredGlyphOf(all.flat(), sprite.colors)
  return [
    ...(all.every((frame) => sizeOf(frame) === size)
      ? []
      : ['frames: every frame must be the size of the first']),
    ...(missing === undefined ? [] : [`colors: glyph "${missing}" has no color`])
  ]
}

const petSchema = z.object({
  name: localizedSceneName.optional(),
  frames: framesSchema,
  happy: castFrame,
  colors: z.record(glyph, color)
})

// Why not strict: a gesture a newer game acts out is ignored here, not a reason to drop the advisor.
const gesturesSchema = z.object({
  lowered: castFrame.optional(),
  raised: castFrame.optional(),
  approved: castFrame.optional(),
  unsure: castFrame.optional(),
  escalated: castFrame.optional(),
  ciRunning: castFrame.optional(),
  ciPassed: castFrame.optional(),
  ciFailed: castFrame.optional(),
  stopped: castFrame.optional(),
  consulting: castFrame.optional(),
  advised: castFrame.optional()
})

const advisorSchema = z.object({
  name: localizedSceneName.optional(),
  frames: framesSchema,
  gestures: gesturesSchema.optional(),
  colors: z.record(glyph, color)
})

export type OrchestratorGameScenePet = z.infer<typeof petSchema>
export type OrchestratorGameSceneAdvisor = z.infer<typeof advisorSchema>
export type OrchestratorGameSceneCast = {
  pet?: OrchestratorGameScenePet
  advisor?: OrchestratorGameSceneAdvisor
}

// Shapes first: a sprite's sizes and colors are only compared once every frame is well formed.
function memberOf<T>(
  path: string,
  schema: z.ZodType<T>,
  raw: unknown,
  spriteOf: (member: T) => Sprite
): { member?: T; issues: string[] } {
  if (raw === undefined) {
    return { issues: [] }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(
        (issue) => `${[path, ...issue.path].join('.')}: ${issue.message}`
      )
    }
  }
  const issues = spriteIssuesOf(spriteOf(parsed.data)).map((one) => `${path}.${one}`)
  return issues.length === 0 ? { member: parsed.data, issues } : { issues }
}

/** The valid part of a scene's `cast`, and why each other part is left out. */
export function orchestratorGameSceneCastOf(raw: unknown): {
  cast?: OrchestratorGameSceneCast
  issues: string[]
} {
  if (raw === undefined) {
    return { issues: [] }
  }
  const shape = z
    .object({ pet: z.unknown().optional(), advisor: z.unknown().optional() })
    .safeParse(raw)
  if (!shape.success) {
    return { issues: shape.error.issues.map((issue) => `cast: ${issue.message}`) }
  }
  const pet = memberOf('cast.pet', petSchema, shape.data.pet, (one) => ({
    frames: one.frames,
    extra: [one.happy],
    colors: one.colors
  }))
  const advisor = memberOf('cast.advisor', advisorSchema, shape.data.advisor, (one) => ({
    frames: one.frames,
    extra: Object.values(one.gestures ?? {}).filter((frame) => frame !== undefined),
    colors: one.colors
  }))
  const cast: OrchestratorGameSceneCast = {
    ...(pet.member === undefined ? {} : { pet: pet.member }),
    ...(advisor.member === undefined ? {} : { advisor: advisor.member })
  }
  return {
    ...(cast.pet === undefined && cast.advisor === undefined ? {} : { cast }),
    issues: [...pet.issues, ...advisor.issues]
  }
}
