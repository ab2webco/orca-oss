import { z } from 'zod'
import { castFrame } from './orchestrator-game-scene-cast'
import { color, glyph, uncoloredGlyphOf } from './orchestrator-game-scene-values'

/** What the hero holds in the panel's Pixel style: Quest's `sword`, or one frame drawn facing right. */
const spriteSchema = z.object(
  { rows: castFrame, colors: z.record(glyph, color) },
  { error: 'must be "sword" or { rows, colors }' }
)

export type OrchestratorGameSceneProp = 'sword' | z.infer<typeof spriteSchema>

// Why apart, like the cast: a bad prop is left out with a warning; the scene still draws.
export function orchestratorGameScenePropOf(raw: unknown): {
  prop?: OrchestratorGameSceneProp
  issues: string[]
} {
  if (typeof raw !== 'object' || raw === null || !('prop' in raw) || raw.prop === undefined) {
    return { issues: [] }
  }
  if (raw.prop === 'sword') {
    return { prop: 'sword', issues: [] }
  }
  const parsed = spriteSchema.safeParse(raw.prop)
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(
        (issue) => `${['prop', ...issue.path].join('.')}: ${issue.message}`
      )
    }
  }
  const missing = uncoloredGlyphOf(parsed.data.rows, parsed.data.colors)
  return missing === undefined
    ? { prop: parsed.data, issues: [] }
    : { issues: [`prop.colors: glyph "${missing}" has no color`] }
}
