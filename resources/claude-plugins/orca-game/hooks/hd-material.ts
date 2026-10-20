import { hash, mix } from './pixel-canvas'

// hd land materials: a four-tone ramp per layer color, picked by smooth noise and lit by which way
// the slope faces the sun. Driven only by a look's colors, so every built-in and user scene gets it.
// Why per pixel and never blended with neighbours or the sky: ORCA-603 keeps every edge hard.

const SHADOW = 0x1c1636
const SHADE = 0x332b5e
const HIGHLIGHT = 0xfff2d6

/** Shadow, shade, the color itself and a warm highlight, in rising lightness. */
export const toneRampOf = (color: number): readonly [number, number, number, number] => [
  mix(color, SHADOW, 0.4),
  mix(color, SHADE, 0.18),
  color,
  mix(color, HIGHLIGHT, 0.16)
]

const smooth = (t: number): number => t * t * (3 - 2 * t)

const latticeOf = (ix: number, iy: number, seed: number): number =>
  (hash(ix + seed * 7919, iy + seed * 104729) % 1024) / 1023

const valueNoiseOf = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const tx = smooth(x - ix)
  const ty = smooth(y - iy)
  const top = latticeOf(ix, iy, seed) * (1 - tx) + latticeOf(ix + 1, iy, seed) * tx
  const bottom = latticeOf(ix, iy + 1, seed) * (1 - tx) + latticeOf(ix + 1, iy + 1, seed) * tx
  return top * (1 - ty) + bottom * ty
}

/** Two octaves of value noise in [0, 1]. */
export const textureOf = (x: number, y: number, seed: number): number =>
  (valueNoiseOf(x, y, seed) * 2 + valueNoiseOf(x * 2.03, y * 2.03, seed + 17)) / 3

/** The ramp tone at a pixel: wide, soft patches across x, finer grain down y. */
export const materialPixel = (color: number, x: number, y: number, seed: number): number => {
  const n = textureOf(x * 0.45, y * 0.7, seed)
  const v = Math.max(0, Math.min(0.999, 0.5 + (n - 0.5) * 2.4))
  return toneRampOf(color)[Math.floor(v * 4)] ?? color
}

/**
 * 0 (turned away) to 1 (facing the sun) from the land's height either side of `x`; 0.5 when flat
 * or straight under the sun.
 */
export const facingOf = (
  leftHeight: number,
  rightHeight: number,
  x: number,
  sunX: number
): number => {
  const toward = Math.sign(sunX - x)
  return 0.5 + Math.max(-0.5, Math.min(0.5, (leftHeight - rightHeight) * toward * 0.15))
}

/** Shades a lit color by facing: away mixes toward shadow, toward mixes toward the key light. */
export const litByFacing = (color: number, facing: number, key: number): number =>
  facing >= 0.5 ? mix(color, key, (facing - 0.5) * 0.5) : mix(color, SHADOW, (0.5 - facing) * 0.6)
