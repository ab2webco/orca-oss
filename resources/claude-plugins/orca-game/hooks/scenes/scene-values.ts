import { GAME_LOCALES, type GameLocale, type LocalizedName } from '../game-strings'

// The values a scene is made of (colors, names, glyphs), re-read from what Orca served.

export type Shape = Record<string, unknown>

export const GLYPH = /^[!-~]$/
const HEX = /^#[0-9a-fA-F]{6}$/
const NAME_MAX = 32

export const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Why both, as Orca's parser: JSON has no hex literals, so a hand-written scene says '#rrggbb'.
export const colorOf = (value: unknown): number | undefined => {
  if (typeof value === 'string') {
    return HEX.test(value) ? Number.parseInt(value.slice(1), 16) : undefined
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff
    ? value
    : undefined
}

// Why: card names reach the terminal verbatim; control, C1 and bidi characters could rewrite it.
const isSafeCode = (code: number): boolean =>
  !(
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    [0x200b, 0x200e, 0x200f, 0x061c, 0x2060, 0xfeff, 0x2028, 0x2029].includes(code) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )

export const textOf = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  [...value].every((one) => isSafeCode(one.codePointAt(0) ?? 0))
    ? value
    : undefined

export const hexOf = (value: unknown): string | undefined =>
  typeof value === 'string' && HEX.test(value) ? value : undefined

// Why: Orca strips languages it does not ship, so an unknown key is ignored, not a failure.
export const nameOf = (value: unknown, max = NAME_MAX): LocalizedName | undefined => {
  if (!isShape(value)) {
    return textOf(value, max)
  }
  const en = textOf(value.en, max)
  if (en === undefined) {
    return undefined
  }
  const name: { en: string } & Partial<Record<GameLocale, string>> = { en }
  for (const locale of GAME_LOCALES) {
    const said = value[locale]
    if (locale === 'en' || said === undefined) {
      continue
    }
    const text = textOf(said, max)
    if (text === undefined) {
      return undefined
    }
    name[locale] = text
  }
  return name
}

/** `colors` as numbers, when every key is one glyph other than '.' and every value a color. */
export const glyphColorsOf = (value: unknown): Record<string, number> | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const entries = Object.entries(value).map(([glyph, color]) => [glyph, colorOf(color)] as const)
  return entries.every(
    ([glyph, color]) => GLYPH.test(glyph) && glyph !== '.' && color !== undefined
  )
    ? (Object.fromEntries(entries) as Record<string, number>)
    : undefined
}
