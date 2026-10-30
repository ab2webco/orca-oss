import { ACCESSORIES } from '../character-look'
import { isRasterText, type LocalizedName } from '../game-strings'
import { castOf } from './cast-shape'
import {
  PLANT_KINDS,
  SCENERIES,
  type BandPalette,
  type Card,
  type CharacterVariant,
  type Costume,
  type HudPalette,
  type Look,
  type LookColor,
  type SceneCharacter,
  type SceneDefinition,
  type ScenePhase,
  type SceneTheme
} from './scene-definition'
import { colorOf, glyphColorsOf, hexOf, isShape, nameOf, textOf, type Shape } from './scene-values'

// Re-validates a scene Orca served, so bad data drops the scene instead of crashing the mod.

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const COSTUME_ROWS = 6
const FINALE_MAX = 24
const SPRITE_ROW = /^[!-~]{10}$/
const LOOK_COLORS: readonly LookColor[] = [
  'skyTop',
  'skyBottom',
  'sun',
  'far',
  'snow',
  'near',
  'ground',
  'plant',
  'cloud'
]

const lookOf = (value: unknown): Look | undefined => {
  if (!isShape(value) || typeof value.isNight !== 'boolean') {
    return undefined
  }
  const plantKind = PLANT_KINDS.find((one) => one === value.plantKind)
  const colors = Object.fromEntries(LOOK_COLORS.map((key) => [key, colorOf(value[key])]))
  if (plantKind === undefined || !LOOK_COLORS.every((key) => colors[key] !== undefined)) {
    return undefined
  }
  const scenery = SCENERIES.find((one) => one === value.scenery)
  const hasScenery = value.scenery !== undefined
  const hasSignal = value.isSignal !== undefined
  if ((hasScenery && scenery === undefined) || (hasSignal && typeof value.isSignal !== 'boolean')) {
    return undefined
  }
  return {
    ...(colors as Record<LookColor, number>),
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
  if (!isShape(value)) {
    return undefined
  }
  const rows = rowsOf(value.rows, COSTUME_ROWS)
  const legs = rowsOf(value.legs, 2)
  const colors = glyphColorsOf(value.colors)
  if (rows === undefined || legs?.[0] === undefined || legs[1] === undefined || !colors) {
    return undefined
  }
  const glyphs = [...rows, ...legs].join('').replaceAll('.', '')
  if (![...glyphs].every((one) => Object.hasOwn(colors, one))) {
    return undefined
  }
  return { rows, legs: [legs[0], legs[1]], colors }
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

// Mirrors Orca's GAME_MEMBER_ROSTER_MAX; a bad roster is dropped, as Orca drops it, never the scene.
const ROSTER_MAX = 24
const rosterOf = (value: unknown): LocalizedName[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > ROSTER_MAX) {
    return undefined
  }
  const names = value.map((one) => nameOf(isCharacterEntry(one) ? one.name : one))
  return names.every((one) => one !== undefined) ? names : undefined
}

// Why `name`: a localized name is `{ en, es }`, so only a character entry carries that key.
const isCharacterEntry = (value: unknown): value is Shape & { name: unknown } =>
  isShape(value) && 'name' in value

const variantOf = (value: unknown): CharacterVariant | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const colors = optionalOf(value.colors, glyphColorsOf)
  const accessory = optionalOf(value.accessory, (one) => ACCESSORIES.find((kind) => kind === one))
  const accessoryColor = optionalOf(value.accessoryColor, colorOf)
  if (colors === null || accessory === null || accessoryColor === null) {
    return undefined
  }
  const isEmpty = accessoryColor !== undefined || Object.keys(colors ?? {}).length === 0
  if (accessory === undefined && isEmpty) {
    return undefined
  }
  return {
    ...(colors === undefined ? {} : { colors }),
    ...(accessory === undefined ? {} : { accessory }),
    ...(accessoryColor === undefined ? {} : { accessoryColor })
  }
}

const characterOf = (value: unknown): SceneCharacter | undefined => {
  if (!isCharacterEntry(value)) {
    return undefined
  }
  const name = nameOf(value.name)
  const variant = optionalOf(value.variant, variantOf)
  const costumes = optionalOf(value.costumes, (one) => byPhaseOf(one, costumeOf))
  if (!name || variant === null || costumes === null || !variant === !costumes) {
    return undefined
  }
  return { name, ...(variant ? { variant } : {}), ...(costumes ? { costumes } : {}) }
}

// Orca serves the looks apart from the names; a scene file read as written keeps them in `roster`.
const charactersOf = (value: Shape): SceneCharacter[] | undefined => {
  const entries = Array.isArray(value.characters)
    ? value.characters
    : Array.isArray(value.roster)
      ? value.roster.filter(isCharacterEntry)
      : []
  const characters = entries.flatMap((one) => characterOf(one) ?? [])
  return characters.length === 0 ? undefined : characters
}

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

const HUD_COLORS = ['skyTop', 'skyBottom', 'frame', 'text', 'dim', 'star'] as const

const hudOf = (value: unknown): HudPalette | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const colors = HUD_COLORS.map((key) => [key, colorOf(value[key])] as const)
  return colors.every(([, one]) => one !== undefined)
    ? (Object.fromEntries(colors) as HudPalette)
    : undefined
}

// Mirrors Orca's theme schema; bad themes are dropped, as Orca drops them, never the scene.
const THEMES_MAX = 8
const themeOf = (value: unknown): SceneTheme | undefined => {
  if (!isShape(value) || !isShape(value.look)) {
    return undefined
  }
  const name = nameOf(value.name)
  const { weight, look } = value
  const colors = LOOK_COLORS.filter((key) => look[key] !== undefined).map(
    (key) => [key, colorOf(look[key])] as const
  )
  const isWeight = typeof weight === 'number' && weight >= 0 && weight <= 1
  if (!name || !isWeight || colors.length === 0 || colors.some(([, one]) => one === undefined)) {
    return undefined
  }
  return { name, weight, look: Object.fromEntries(colors) }
}

const themesOf = (value: unknown): SceneTheme[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > THEMES_MAX) {
    return undefined
  }
  const themes = value.map(themeOf)
  return themes.every((one) => one !== undefined) ? themes : undefined
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
    const hud = optionalOf(value.hud, hudOf)
    const cast = castOf(value.cast)
    const roster = rosterOf(value.roster)
    const characters = roster === undefined ? undefined : charactersOf(value)
    const themes = themesOf(value.themes)
    if (
      !looks ||
      !costumes ||
      !cards ||
      !teller ||
      !band ||
      foe === null ||
      finale === null ||
      hud === null
    ) {
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
      ...(finale === undefined ? {} : { finale }),
      ...(hud === undefined ? {} : { hud }),
      ...(cast === undefined ? {} : { cast }),
      ...(roster === undefined ? {} : { roster }),
      ...(characters === undefined ? {} : { characters }),
      ...(themes === undefined ? {} : { themes })
    }
  } catch {
    return undefined
  }
}
