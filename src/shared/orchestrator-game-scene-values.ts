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
