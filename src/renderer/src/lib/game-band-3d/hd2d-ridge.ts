// A ridge's vertices from one height per column, shared by every library that draws the land.
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import { LAYER } from './hd2d-layout'
import { linearOf } from './hd2d-lighting'
import type { Hd2dWorld } from './hd2d-world'

export const RIDGE_ROWS = 3

export type RidgeArgs = {
  heights: Float32Array
  scale: number
  top: number
  base: number
  /** Heights above this get the cap colour. */
  capAbove?: number
  cap?: number
}

/**
 * A top row on the silhouette, a lower row and a base, so the colour falls off smoothly and each
 * flank's normal leans toward or away from the sun. Colours are linear RGB.
 */
export const ridgeVerticesOf = (
  args: RidgeArgs
): { positions: Float32Array; normals: Float32Array; colors: Float32Array; index: Uint32Array } => {
  const { heights, scale } = args
  const n = heights.length
  const positions = new Float32Array(n * RIDGE_ROWS * 3)
  const normals = new Float32Array(n * RIDGE_ROWS * 3)
  const colors = new Float32Array(n * RIDGE_ROWS * 3)
  const middle = mix(args.top, args.base, 0.5)
  for (let x = 0; x < n; x += 1) {
    const h = heights[x] ?? 0
    const slope = ((heights[x + 1] ?? h) - (heights[x - 1] ?? h)) / 2
    const lean = Math.hypot(slope, 1, 0.9)
    const capped = args.capAbove !== undefined && args.cap !== undefined && h > args.capAbove
    const ys = [h, h * 0.55, -2]
    ys.forEach((y, r) => {
      const v = x * RIDGE_ROWS + r
      positions.set([x * scale, y * scale, 0], v * 3)
      normals.set([-slope / lean, 1 / lean, 0.9 / lean], v * 3)
      const shade =
        r === 0 ? (capped ? (args.cap ?? args.top) : args.top) : r === 1 ? middle : args.base
      colors.set(linearOf(shade), v * 3)
    })
  }
  const index = new Uint32Array((n - 1) * (RIDGE_ROWS - 1) * 6)
  let i = 0
  for (let x = 0; x < n - 1; x += 1) {
    for (let r = 0; r < RIDGE_ROWS - 1; r += 1) {
      const a = x * RIDGE_ROWS + r
      const b = (x + 1) * RIDGE_ROWS + r
      index.set([a, a + 1, b, b, a + 1, b + 1], i)
      i += 6
    }
  }
  return { positions, normals, colors, index }
}

/** The far snow-capped range and the mid hills of a world, each scaled to its layer depth. */
export const ridgesOf = (world: Hd2dWorld): { far: RidgeArgs; mid: RidgeArgs } => {
  const horizon = horizonOf(world)
  return {
    far: {
      heights: world.far.heights,
      scale: LAYER.far,
      top: mix(world.far.color, world.far.snow, 0.12),
      base: mix(world.far.color, horizon, 0.25),
      capAbove: world.pixels * 0.45,
      cap: world.far.snow
    },
    mid: {
      heights: world.mid.heights,
      scale: LAYER.mid,
      top: world.mid.color,
      base: mix(world.mid.color, 0x000000, 0.35)
    }
  }
}

/** The sky's lowest row: the fog colour every layer fades toward. */
export const horizonOf = (world: Hd2dWorld): number => world.sky.at(-1) ?? 0x8ccaf5
