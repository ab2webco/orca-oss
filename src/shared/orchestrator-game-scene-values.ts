import { z } from 'zod'
import { isSafeDisplayCharacter } from './skill-display-text'

/** The values a scene file is made of: colors, names and sprite glyphs, as Orca validates them. */

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color')
// Why both: JSON has no hex literals, so authors write '#rrggbb'; the mod always receives a number.
export const color = z.union(
  [
    z.number().int().min(0).max(0xffffff),
    hexColor.transform((value) => Number.parseInt(value.slice(1), 16))
  ],
  { error: 'must be a #rrggbb color or an integer from 0 to 16777215' }
)
// Why: names reach the terminal verbatim, so control and bidi characters could rewrite the screen.
export const displayText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => [...value].every(isSafeDisplayCharacter),
      'must not contain control characters'
    )
export const glyph = z
  .string()
  .regex(/^[!-~]$/, 'must be one printable ASCII glyph')
  .refine((key) => key !== '.', {
    message: "'.' is reserved for transparent"
  })

const sceneName = displayText(32)
// Why: the mod shows the name in Orca's UI language; unknown languages are stripped, not rejected.
export const localizedSceneName = z.union([
  sceneName,
  z.object({
    en: sceneName,
    es: sceneName.optional()
  })
])

/** The first glyph of `rows` that `colors` has no entry for. */
export function uncoloredGlyphOf(
  rows: readonly string[],
  colors: Readonly<Record<string, unknown>>
): string | undefined {
  return [...rows.join('')].find((one) => one !== '.' && !Object.hasOwn(colors, one))
}

// Why: the mod draws a costume as six rows plus a legs row inside an eight-pixel tile.
export const ORCHESTRATOR_GAME_COSTUME_ROWS = 6

// Why ASCII: the mod indexes rows by UTF-16 unit, so one glyph must be one unit.
const spriteRow = z.string().regex(/^[!-~]{10}$/, 'must be ten printable ASCII glyphs')

export const costumeSchema = z
  .object({
    rows: z.array(spriteRow).length(ORCHESTRATOR_GAME_COSTUME_ROWS),
    legs: z.tuple([spriteRow, spriteRow]),
    colors: z.record(glyph, color)
  })
  .superRefine((costume, ctx) => {
    const missing = uncoloredGlyphOf([...costume.rows, ...costume.legs], costume.colors)
    if (missing !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['colors'], message: `glyph "${missing}" has no color` })
    }
  })

export const byPhase = <T extends z.ZodType>(schema: T) =>
  z.object({
    working: schema,
    docs: schema,
    build: schema,
    verify: schema,
    pr: schema,
    handoff: schema
  })
