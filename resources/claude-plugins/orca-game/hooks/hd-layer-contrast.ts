import { lightnessOf, luminanceOf, luminanceOfLightness, withLuminance } from './hd-lightness'

// Far and mid scenery keep at least LAYER_FLOOR of lightness (CIE L*) from the sky row behind them.

export const LAYER_FLOOR = 8
// Why: a layer kept darker than a night sky ends up nearly black, so below this it goes lighter.
const DARKEST_LAYER = 10

export type LayerContrast = {
  /** -1 keeps the layer darker than the sky, 1 lighter. */
  side: -1 | 1
  /** Per sky row: its luminance, and the most a darker and the least a lighter pixel may have. */
  sky: Float64Array
  dark: Float64Array
  light: Float64Array
  /** Pixels already moved, by colour and row; a cached frame reuses them. */
  moved: Map<number, number>
}

/** Which side of the sky a layer stays on, decided once for the whole layer so it never bands. */
export const layerContrastOf = (
  skyLightness: Float64Array,
  reference: number,
  fromRow: number
): LayerContrast => {
  let sum = 0
  let darkest = 100
  let brightest = 0
  const from = Math.max(0, Math.min(skyLightness.length - 1, fromRow))
  for (let y = from; y < skyLightness.length; y += 1) {
    const l = skyLightness[y] ?? 0
    sum += l
    darkest = Math.min(darkest, l)
    brightest = Math.max(brightest, l)
  }
  const mean = sum / Math.max(1, skyLightness.length - from)
  const canDarken = darkest - LAYER_FLOOR >= DARKEST_LAYER
  const canLighten = brightest + LAYER_FLOOR <= 100
  const isDarker = lightnessOf(reference) < mean ? canDarken || !canLighten : !canLighten
  return {
    side: isDarker ? -1 : 1,
    sky: skyLightness.map(luminanceOfLightness),
    dark: skyLightness.map((l) => (l < LAYER_FLOOR ? -1 : luminanceOfLightness(l - LAYER_FLOOR))),
    light: skyLightness.map((l) =>
      l + LAYER_FLOOR > 100 ? 2 : luminanceOfLightness(l + LAYER_FLOOR)
    ),
    moved: new Map()
  }
}

const pushed = (color: number, own: number, contrast: LayerContrast, y: number, side: number) => {
  const target = (side < 0 ? contrast.dark[y] : contrast.light[y]) ?? own
  if (side < 0 ? own <= target : own >= target) {
    return color
  }
  const key = color * 64 + y * 2 + (side < 0 ? 0 : 1)
  const kept = contrast.moved.get(key)
  if (kept !== undefined) {
    return kept
  }
  const made = withLuminance(color, target)
  contrast.moved.set(key, made)
  return made
}

/** A layer pixel moved just far enough from its sky row, on the layer's side. */
export const apartFromSky = (color: number, contrast: LayerContrast, y: number): number =>
  pushed(color, luminanceOf(color), contrast, y, contrast.side)

/** A highlight (snow, a lit window, a glint) moved apart on its own side, where that side has room. */
export const accentApartFromSky = (color: number, contrast: LayerContrast, y: number): number => {
  const own = luminanceOf(color)
  const isBelow = own < (contrast.sky[y] ?? 0)
  const side = isBelow
    ? (contrast.dark[y] ?? -1) >= 0
      ? -1
      : 1
    : (contrast.light[y] ?? 2) <= 1
      ? 1
      : -1
  return pushed(color, own, contrast, y, side)
}
