import { luminanceOf, withLuminance } from './hd-lightness'
import { mix } from './pixel-canvas'
import type { Costume } from './scenes/index'

// hd characters: any glyph art gets a 1-px outline and a lit and a shaded side, from its own palette.

const EDGE = '#'
// Why a ceiling: a bright palette's darkest colour (a cyan cape) would outline as a glow, not ink.
const INK_CEILING = 0.03
const INK_RATIO = 0.5

export type HdSprite = {
  /** The art grown by one pixel on every side; `#` is the outline. */
  rows: readonly string[]
  /** Per pixel: -1 shaded, 1 lit, 0 flat. */
  shade: Int8Array
  width: number
  colors: Readonly<Record<string, number>>
  outline: number
  /** The luminance the outline and any state ring stay under. */
  ink: number
}

const lumaOf = (color: number): number =>
  0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255)

const darkestOf = (colors: Readonly<Record<string, number>>): number =>
  Object.values(colors).reduce<number | undefined>(
    (best, one) => (best === undefined || lumaOf(one) < lumaOf(best) ? one : best),
    undefined
  ) ?? 0x202020

export const inkOf = (colors: Readonly<Record<string, number>>): number =>
  Math.min(INK_CEILING, luminanceOf(darkestOf(colors)) * INK_RATIO)

const inked = (color: number, ink: number): number =>
  luminanceOf(color) < ink ? color : withLuminance(color, ink * 0.97)

const outlines = new WeakMap<object, number>()

/** The palette's darkest colour pushed toward black, so a scene file's figures keep their own ink. */
export const outlineOf = (colors: Readonly<Record<string, number>>): number => {
  const kept = outlines.get(colors)
  if (kept !== undefined) {
    return kept
  }
  const made = inked(mix(darkestOf(colors), 0x000000, 0.55), inkOf(colors))
  outlines.set(colors, made)
  return made
}

const rings = new Map<number, Map<number, number>>()

/** A state colour darkened to the sprite's ink, so a teammate's ring tints its outline without glowing. */
export const ringOf = (sprite: HdSprite, ring: number): number => {
  const own = rings.get(sprite.ink) ?? new Map<number, number>()
  rings.set(sprite.ink, own)
  const kept = own.get(ring)
  if (kept !== undefined) {
    return kept
  }
  const made = inked(ring, sprite.ink)
  own.set(ring, made)
  return made
}

const spriteOf = (body: readonly string[], colors: Readonly<Record<string, number>>): HdSprite => {
  const at = (r: number, c: number): string => body[r]?.[c] ?? '.'
  const width = Math.max(0, ...body.map((row) => row.length)) + 2
  const rows: string[] = []
  const shade: number[] = []
  for (let r = -1; r <= body.length; r += 1) {
    let line = ''
    for (let c = -1; c < width - 1; c += 1) {
      const own = at(r, c)
      if (own !== '.') {
        line += own
        const isShaded = at(r, c + 1) === '.' || at(r + 1, c) === '.'
        shade.push(isShaded ? -1 : at(r - 1, c) === '.' || at(r, c - 1) === '.' ? 1 : 0)
        continue
      }
      const isEdge = [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].some(
        (one) => one !== '.'
      )
      line += isEdge ? EDGE : '.'
      shade.push(0)
    }
    rows.push(line)
  }
  const outline = outlineOf(colors)
  return { rows, shade: Int8Array.from(shade), width, colors, outline, ink: inkOf(colors) }
}

const frames = new WeakMap<object, Map<string, HdSprite>>()

const cachedOf = (owner: object, key: string, make: () => HdSprite): HdSprite => {
  const own = frames.get(owner) ?? new Map<string, HdSprite>()
  frames.set(owner, own)
  const kept = own.get(key)
  if (kept !== undefined) {
    return kept
  }
  const made = make()
  own.set(key, made)
  return made
}

/** A costume standing (legs `frame`) or sitting (no legs). */
export const costumeSpriteOf = (costume: Costume, frame: number, isSitting: boolean): HdSprite =>
  cachedOf(costume, `${isSitting ? 's' : frame % 2}`, () =>
    spriteOf(
      isSitting ? costume.rows : [...costume.rows, costume.legs[frame % 2] ?? ''],
      costume.colors
    )
  )

/** A cast frame (pet, advisor) with its own palette. */
export const frameSpriteOf = (
  frame: readonly string[],
  colors: Readonly<Record<string, number>>
): HdSprite => cachedOf(frame, 'f', () => spriteOf(frame, colors))

/** The sprite's colour at (x, y) with its top-left corner at (left, top); `ring` tints the outline. */
export const hdSpritePixel = (
  sprite: HdSprite,
  x: number,
  y: number,
  left: number,
  top: number,
  ring?: number
): number | undefined => {
  const r = y - top
  const c = x - left
  // Why first: a negative index leaves the array's fast path, and this runs per figure per pixel.
  if (r < 0 || c < 0 || r >= sprite.rows.length || c >= sprite.width) {
    return undefined
  }
  const glyph = sprite.rows[r]?.[c]
  if (glyph === undefined || glyph === '.') {
    return undefined
  }
  if (glyph === EDGE) {
    return ring === undefined ? sprite.outline : ringOf(sprite, ring)
  }
  const color = sprite.colors[glyph]
  if (color === undefined) {
    return undefined
  }
  const shade = sprite.shade[r * sprite.width + c] ?? 0
  return shade < 0 ? mix(color, 0x000000, 0.24) : shade > 0 ? mix(color, 0xffffff, 0.18) : color
}
