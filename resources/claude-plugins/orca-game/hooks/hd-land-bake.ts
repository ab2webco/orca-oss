import { landInLight } from './hd-daylight'
import { mod } from './pixel-canvas'
import {
  hdFarPhaseOf,
  hdFarPixel,
  hdGroundPixel,
  hdFarShiftOf,
  hdMidPixel,
  hdMidShiftOf,
  type HdFrame
} from './scene-hd-land'
import type { Look } from './scenes/index'

// hd's land baked per world column: a scroll step computes only the columns it brings in, a frame
// at rest none. Kept while the look, size, hour and sun hold; the far range's own tick re-bakes it.

const EMPTY = -1
const MAX_KEPT = 4

/** One layer's columns, by world column modulo the width; a tag says which column a slot holds. */
type Layer = { tags: Float64Array; colors: Int32Array; rows: number; top: number }

export type HdLandBake = { far: Layer; mid: Layer; ground: Layer; farPhase: number }

const layerOf = (width: number, rows: number, top: number): Layer => ({
  tags: new Float64Array(width).fill(Number.NaN),
  colors: new Int32Array(width * rows),
  rows,
  top
})

const bakes = new WeakMap<Look, Map<string, HdLandBake>>()

export const hdLandBakeOf = (frame: HdFrame): HdLandBake => {
  const { look, width, pixels, ground, light } = frame
  const key = `${width}x${pixels}@${ground}:${light.night}:${light.dusk}:${frame.sunX}`
  const own = bakes.get(look) ?? new Map<string, HdLandBake>()
  bakes.set(look, own)
  const phase = hdFarPhaseOf(look, frame.tick)
  const kept = own.get(key)
  if (kept !== undefined) {
    if (kept.farPhase !== phase) {
      kept.far.tags.fill(Number.NaN)
      kept.farPhase = phase
    }
    return kept
  }
  if (own.size >= MAX_KEPT) {
    own.clear()
  }
  const made = {
    far: layerOf(width, ground, 0),
    mid: layerOf(width, ground, 0),
    ground: layerOf(width, pixels - ground, ground),
    farPhase: phase
  }
  own.set(key, made)
  return made
}

// Why the sun's side in the tag: a layer's facing turns where its column passes under the sun.
const bakedOf = (
  layer: Layer,
  world: number,
  side: number,
  frame: HdFrame,
  x: number,
  y: number,
  pixelOf: (frame: HdFrame, x: number, y: number) => number | undefined
): number | undefined => {
  const slot = mod(world, layer.tags.length)
  const tag = world * 3 + side + 1
  const base = slot * layer.rows
  if (layer.tags[slot] !== tag) {
    for (let row = 0; row < layer.rows; row += 1) {
      layer.colors[base + row] = pixelOf(frame, x, layer.top + row) ?? EMPTY
    }
    layer.tags[slot] = tag
  }
  const color = layer.colors[base + y - layer.top] ?? EMPTY
  return color === EMPTY ? undefined : color
}

/** The hills over the far range at (x, y) above the ground, or undefined where the sky shows. */
export const hdBakedLandOf = (
  bake: HdLandBake,
  frame: HdFrame,
  x: number,
  y: number
): number | undefined => {
  const side = Math.sign(frame.sunX - x)
  return (
    bakedOf(bake.mid, x + hdMidShiftOf(frame.scroll), side, frame, x, y, hdMidPixel) ??
    bakedOf(bake.far, x + hdFarShiftOf(frame.scroll), side, frame, x, y, hdFarPixel)
  )
}

const litGroundPixel = (frame: HdFrame, x: number, y: number): number =>
  landInLight(hdGroundPixel(frame, x, y), frame.light, frame.dayLift, frame.look.isNight)

/** The ground at (x, y) on or under the ground line, lit for the hour. */
export const hdBakedGroundOf = (bake: HdLandBake, frame: HdFrame, x: number, y: number): number =>
  bakedOf(bake.ground, x + frame.scroll, 0, frame, x, y, litGroundPixel) ?? 0
