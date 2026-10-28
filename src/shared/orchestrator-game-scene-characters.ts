import { z } from 'zod'
import { parseMemberRoster, type GameMemberName } from './orchestrator-game-member-names'
import { byPhase, color, costumeSchema, glyph } from './orchestrator-game-scene-values'

/** A roster entry's own look: a palette and accessory over the phase costumes, or costumes of its own. */

// Mirrors the mod's ACCESSORY_ART, which draws each one around a costume's head.
export const ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES = [
  'crown',
  'halo',
  'horns',
  'antenna',
  'bow',
  'feather',
  'cape'
] as const

const accessoryError = `must be one of ${ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES.join(', ')}`

const variantSchema = z
  .object({
    colors: z.record(glyph, color).optional(),
    accessory: z
      .enum(ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES, { error: accessoryError })
      .optional(),
    accessoryColor: color.optional()
  })
  .superRefine((variant, ctx) => {
    if (variant.accessory !== undefined) {
      return
    }
    if (variant.accessoryColor !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['accessoryColor'], message: 'needs an accessory' })
    } else if (Object.keys(variant.colors ?? {}).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must set colors or an accessory' })
    }
  })

const lookSchema = z.object({
  variant: variantSchema.optional(),
  costumes: byPhase(costumeSchema).optional()
})

export type OrchestratorGameCharacterAccessory =
  (typeof ORCHESTRATOR_GAME_CHARACTER_ACCESSORIES)[number]
export type OrchestratorGameSceneCharacter = { name: GameMemberName } & z.infer<typeof lookSchema>

// Why `name`: a localized name is `{ en, es }`, so only a character entry carries that key.
const isCharacterEntry = (entry: unknown): entry is { name: unknown } =>
  typeof entry === 'object' && entry !== null && 'name' in entry

/**
 * A scene roster's names and the looks its character entries bring, or every reason it is refused.
 * `glyphs` are the ones the phase costumes color; a palette glyph outside them changes nothing.
 */
export function sceneRosterOf(
  raw: unknown,
  glyphs?: ReadonlySet<string>
): { roster?: GameMemberName[]; characters?: OrchestratorGameSceneCharacter[]; issues: string[] } {
  const entries: readonly unknown[] | undefined = Array.isArray(raw) ? raw : undefined
  const { roster, problems } = parseMemberRoster(
    entries?.map((entry) => (isCharacterEntry(entry) ? entry.name : entry)) ?? raw
  )
  const issues = problems.map(({ path, message }) => {
    const [index, ...rest] = path === '' ? [] : path.split('.')
    const inEntry = index !== undefined && isCharacterEntry(entries?.[Number(index)])
    const at = index === undefined ? [] : [index, ...(inEntry ? ['name'] : []), ...rest]
    return `${['roster', ...at].join('.')}: ${message}`
  })
  const characters: OrchestratorGameSceneCharacter[] = []
  entries?.forEach((entry, index) => {
    if (!isCharacterEntry(entry)) {
      return
    }
    const parsed = lookSchema.safeParse(entry)
    if (!parsed.success) {
      issues.push(
        ...parsed.error.issues.map(
          (issue) => `${['roster', index, ...issue.path].join('.')}: ${issue.message}`
        )
      )
      return
    }
    const { variant, costumes } = parsed.data
    if (variant !== undefined && costumes !== undefined) {
      issues.push(`roster.${index}: set a variant or costumes, not both`)
      return
    }
    const stray = Object.keys(variant?.colors ?? {}).find((one) => glyphs?.has(one) === false)
    if (stray !== undefined) {
      issues.push(`roster.${index}.variant.colors: glyph "${stray}" is in no costume`)
    }
    const name = roster?.[index]
    if (name !== undefined && (variant !== undefined || costumes !== undefined)) {
      characters.push({ name, ...parsed.data })
    }
  })
  if (issues.length > 0) {
    return { issues }
  }
  return { roster, ...(characters.length === 0 ? {} : { characters }), issues }
}
