import type { LocalizedName } from './game-strings'
import { NAMED_TICKET } from './member-character'
import type { CharacterVariant, Costume, SceneDefinition, ScenePhase } from './scenes/index'

// A name's lasting look, derived from the name alone so every pane on every host draws the same one.

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const HUES = 8
const HUE_STEP = 360 / HUES
const ACCESSORY_LOOKS = 8
const SLOTS = HUES * ACCESSORY_LOOKS * PHASES.length
const RECOLORED = 2

// FNV-1a: small, stable across engines, and spreads names that differ by one letter.
const hashOf = (text: string): number => {
  let hash = 0x811c9dc5
  for (const unit of text) {
    hash = Math.imul(hash ^ (unit.codePointAt(0) ?? 0), 0x01000193) >>> 0
  }
  return hash
}

const variantsOf = (name: LocalizedName): string[] =>
  (typeof name === 'string' ? [name] : Object.values(name)).map((one) => one.toLowerCase())

/** Whose look a member wears: its character, else its ticket, else its whole name. */
export const lookKeyOf = (memberName: string): string => {
  const named = NAMED_TICKET.exec(memberName)
  return (named?.[1] ?? named?.[2] ?? memberName).trim().toLowerCase()
}

const hueOf = (slot: number): number => slot % HUES

// Why through the roster: hashes alone collide in a dozen names, and a roster is the same everywhere.
const rosterSlotsOf = (roster: readonly LocalizedName[]): Map<string, number> => {
  const slots = new Map<string, number>()
  const given: number[] = []
  for (const name of roster) {
    const variants = variantsOf(name)
    let slot = hashOf(variants[0] ?? '')
    const hues = new Set(given.map(hueOf))
    while (hues.size < HUES && hues.has(hueOf(slot))) {
      slot += 1
    }
    while (given.some((one) => one % SLOTS === slot % SLOTS)) {
      slot += HUES
    }
    given.push(slot)
    variants.forEach((variant) => slots.set(variant, slot))
  }
  return slots
}

const rosters = new WeakMap<SceneDefinition, Map<string, number>>()

const slotOf = (scene: SceneDefinition, key: string): number => {
  const slots = rosters.get(scene) ?? rosterSlotsOf(scene.roster ?? [])
  rosters.set(scene, slots)
  return slots.get(key) ?? hashOf(key)
}

const hslOf = (color: number): [hue: number, saturation: number, lightness: number] => {
  const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255].map((one) => one / 255)
  const [red, green, blue] = [r ?? 0, g ?? 0, b ?? 0]
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const span = high - low
  const lightness = (high + low) / 2
  if (span === 0) {
    return [0, 0, lightness]
  }
  const sector =
    high === red
      ? ((green - blue) / span + 6) % 6
      : high === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4
  return [sector * 60, span / (1 - Math.abs(2 * lightness - 1)), lightness]
}

const rgbOf = (hue: number, saturation: number, lightness: number): number => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const channel = (shift: number): number => {
    const at = (shift + hue / 30) % 12
    const value = lightness - chroma * Math.max(-1, Math.min(at - 3, 9 - at, 1)) * 0.5
    return Math.round(value * 255)
  }
  return (channel(0) << 16) | (channel(8) << 8) | channel(4)
}

// Why skin and greys stay: a blue face or a tinted eye reads as a glitch, not as another character.
const canRecolor = ([hue, saturation, lightness]: readonly number[]): boolean => {
  const [h = 0, s = 0, l = 0] = [hue, saturation, lightness]
  const isSkin = h >= 15 && h <= 50 && l > 0.55
  return s >= 0.12 && l > 0.1 && l < 0.92 && !isSkin
}

const drawnColorsOf = (costume: Costume): number[] => {
  const counts = new Map<number, number>()
  for (const glyph of costume.rows.join('').replaceAll('.', '')) {
    const color = costume.colors[glyph]
    if (color !== undefined) {
      counts.set(color, (counts.get(color) ?? 0) + 1)
    }
  }
  return [...counts].toSorted((a, b) => b[1] - a[1]).map(([color]) => color)
}

const rotatedColorsOf = (costume: Costume, degrees: number): Record<string, number> => {
  const main = drawnColorsOf(costume)
    .filter((color) => canRecolor(hslOf(color)))
    .slice(0, RECOLORED)
  return Object.fromEntries(
    Object.entries(costume.colors).flatMap(([glyph, color]) => {
      if (!main.includes(color)) {
        return []
      }
      const [hue, saturation, lightness] = hslOf(color)
      return [[glyph, rgbOf((hue + degrees) % 360, saturation, lightness)]]
    })
  )
}

/** The phase costume a slot makes the character's one body, whatever phase it is in. */
export const bodyOf = (scene: SceneDefinition, key: string, wanted?: CharacterVariant): Costume => {
  const slot = slotOf(scene, key)
  const first = Math.floor(slot / (HUES * ACCESSORY_LOOKS)) % PHASES.length
  const order = PHASES.map((_, i) => PHASES[(first + i) % PHASES.length] ?? 'working')
  const glyphs = Object.keys(wanted?.colors ?? {})
  // Why: a palette over a costume that never draws its glyphs would show nothing of it.
  const shows = (phase: ScenePhase): boolean =>
    glyphs.some((one) => scene.costumes[phase].rows.join('').includes(one))
  return scene.costumes[order.find(shows) ?? order[0] ?? 'working']
}

/** The palette and accessory a plain roster name, or a name outside any roster, wears. */
export const derivedVariantOf = (
  scene: SceneDefinition,
  key: string,
  accessories: readonly NonNullable<CharacterVariant['accessory']>[]
): CharacterVariant => {
  const slot = slotOf(scene, key)
  const accessory = accessories[Math.floor(slot / HUES) % ACCESSORY_LOOKS]
  return {
    colors: rotatedColorsOf(bodyOf(scene, key), hueOf(slot) * HUE_STEP),
    ...(accessory === undefined ? {} : { accessory })
  }
}
