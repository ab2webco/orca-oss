import { GAME_LOCALES, isRasterText, type GameLocale, type LocalizedName } from '../game-strings'
import {
  PLANT_KINDS,
  SCENERIES,
  type BandPalette,
  type Card,
  type Costume,
  type Look,
  type SceneDefinition,
  type ScenePhase
} from './scene-definition'

// Re-validates a scene Orca served, so bad data drops the scene instead of crashing the mod.

type Shape = Record<string, unknown>

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const COSTUME_ROWS = 6
const NAME_MAX = 32
const FINALE_MAX = 24
const SPRITE_ROW = /^[!-~]{10}$/
const GLYPH = /^[!-~]$/
const HEX = /^#[0-9a-fA-F]{6}$/
const LOOK_COLORS = [
  'skyTop',
  'skyBottom',
  'sun',
  'far',
  'snow',
  'near',
  'ground',
  'plant',
  'cloud'
] as const

const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isColor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff

// Why: card names reach the terminal verbatim; control, C1 and bidi characters could rewrite it.
const isSafeCode = (code: number): boolean =>
  !(
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    [0x200b, 0x200e, 0x200f, 0x061c, 0x2060, 0xfeff, 0x2028, 0x2029].includes(code) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )

const textOf = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  [...value].every((one) => isSafeCode(one.codePointAt(0) ?? 0))
    ? value
    : undefined

const lookOf = (value: unknown): Look | undefined => {
  if (!isShape(value) || typeof value.isNight !== 'boolean') {
    return undefined
  }
  const plantKind = PLANT_KINDS.find((one) => one === value.plantKind)
  if (plantKind === undefined || !LOOK_COLORS.every((key) => isColor(value[key]))) {
    return undefined
  }
  const scenery = SCENERIES.find((one) => one === value.scenery)
  const hasScenery = value.scenery !== undefined
  const hasSignal = value.isSignal !== undefined
  if ((hasScenery && scenery === undefined) || (hasSignal && typeof value.isSignal !== 'boolean')) {
    return undefined
  }
  const colors = Object.fromEntries(LOOK_COLORS.map((key) => [key, value[key]])) as Record<
    (typeof LOOK_COLORS)[number],
    number
  >
  return {
    ...colors,
    isNight: value.isNight,
    plantKind,
    ...(scenery === undefined ? {} : { scenery }),
    ...(typeof value.isSignal === 'boolean' ? { isSignal: value.isSignal } : {})
  }
}

const rowsOf = (value: unknown, count: number): string[] | undefined =>
  Array.isArray(value) &&
  value.length === count &&
  value.every((row) => typeof row === 'string' && SPRITE_ROW.test(row))
    ? (value as string[])
    : undefined

const costumeOf = (value: unknown): Costume | undefined => {
  if (!isShape(value) || !isShape(value.colors)) {
    return undefined
  }
  const rows = rowsOf(value.rows, COSTUME_ROWS)
  const legs = rowsOf(value.legs, 2)
  const entries = Object.entries(value.colors)
  if (rows === undefined || legs === undefined || legs[0] === undefined || legs[1] === undefined) {
    return undefined
  }
  if (!entries.every(([glyph, color]) => GLYPH.test(glyph) && glyph !== '.' && isColor(color))) {
    return undefined
  }
  const colors = Object.fromEntries(entries) as Record<string, number>
  const glyphs = [...rows, ...legs].join('').replaceAll('.', '')
  if (![...glyphs].every((one) => Object.hasOwn(colors, one))) {
    return undefined
  }
  return { rows, legs: [legs[0], legs[1]], colors }
}

const hexOf = (value: unknown): string | undefined =>
  typeof value === 'string' && HEX.test(value) ? value : undefined

// Why: Orca strips languages it does not ship, so an unknown key is ignored, not a failure.
const nameOf = (value: unknown, max = NAME_MAX): LocalizedName | undefined => {
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

// Why width-1: a Raster refuses the whole frame over one wide character.
const finaleOf = (value: unknown): LocalizedName | undefined => {
  const finale = nameOf(value, FINALE_MAX)
  const texts = typeof finale === 'object' ? Object.values(finale) : [finale]
  return texts.every((one) => one !== undefined && isRasterText(one)) ? finale : undefined
}

// Absent stays absent; present but invalid drops the scene, as Orca's schema does.
const optionalOf = <T>(value: unknown, of: (one: unknown) => T | undefined): T | null | undefined =>
  value === undefined ? undefined : (of(value) ?? null)

const cardOf = (value: unknown): Card | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const icon = textOf(value.icon, 4)
  const name = nameOf(value.name)
  const color = hexOf(value.color)
  return icon && name && color ? { icon, name, color } : undefined
}

const bandOf = (value: unknown): BandPalette | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const gold = hexOf(value.gold)
  const ink = hexOf(value.ink)
  const panel = hexOf(value.panel)
  const parchment = hexOf(value.parchment)
  return gold && ink && panel && parchment ? { gold, ink, panel, parchment } : undefined
}

const byPhaseOf = <T>(
  value: unknown,
  of: (one: unknown) => T | undefined
): Record<ScenePhase, T> | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const pairs = PHASES.map((phase) => [phase, of(value[phase])] as const)
  return pairs.every(([, one]) => one !== undefined)
    ? (Object.fromEntries(pairs) as Record<ScenePhase, T>)
    : undefined
}

export const sceneDefinitionOf = (value: unknown, id: string): SceneDefinition | undefined => {
  try {
    if (!isShape(value)) {
      return undefined
    }
    const looks = byPhaseOf(value.looks, lookOf)
    const costumes = byPhaseOf(value.costumes, costumeOf)
    const cards = byPhaseOf(value.cards, cardOf)
    const teller = cardOf(value.teller)
    const band = bandOf(value.band)
    const foe = optionalOf(value.foe, costumeOf)
    const finale = optionalOf(value.finale, finaleOf)
    if (!looks || !costumes || !cards || !teller || !band || foe === null || finale === null) {
      return undefined
    }
    return {
      id,
      looks,
      costumes,
      cards,
      teller,
      band,
      ...(foe === undefined ? {} : { foe }),
      ...(finale === undefined ? {} : { finale })
    }
  } catch {
    return undefined
  }
}
