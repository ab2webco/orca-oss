import type { Daylight } from './hd-daylight'
import { lightnessOf, luminanceOf, luminanceOfLightness, withLuminance } from './hd-lightness'
import { mix } from './pixel-canvas'
import type { Look } from './scenes/index'

// What keeps any scene readable, computed from its own look: figures apart from what is behind
// them, the backdrop muted behind the figures, and a floor apart from the land. Hard edges only.

/** The least lightness (CIE L*) between a figure's edge and the pixel behind it. */
export const FIGURE_FLOOR = 30
/** The least lightness between the walking strip and the land right behind it. */
export const GROUND_FLOOR = 12

const RIM_MAX = 98
const RIM_MARGIN = 4
const COOL = 0x5a6a8c

/**
 * A figure's outline over `behind`: its ink where that already stands apart, else a rim of the
 * look's own light (or the state ring's colour) lifted just past the floor.
 */
export const figureEdgeOf = (ink: number, behind: number, look: Look, tint?: number): number => {
  const back = lightnessOf(behind)
  if (Math.abs(lightnessOf(ink) - back) >= FIGURE_FLOOR) {
    return ink
  }
  const hue = tint ?? mix(look.sun, 0xffffff, 0.5)
  const lighter = back + FIGURE_FLOOR + RIM_MARGIN
  const target = lighter <= RIM_MAX ? lighter : Math.max(0, back - FIGURE_FLOOR - RIM_MARGIN)
  return withLuminance(hue, luminanceOfLightness(target))
}

/** A far or mid layer colour muted and cooled toward the night, at its own luminance. */
export const pushedBackOf = (color: number, light: Daylight): number => {
  const own = luminanceOf(color)
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  const grey = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  const muted = mix(color, (grey << 16) | (grey << 8) | grey, 0.45 + light.night * 0.35)
  return withLuminance(mix(muted, COOL, light.night * 0.15), own)
}
