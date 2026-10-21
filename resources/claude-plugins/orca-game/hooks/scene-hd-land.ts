import { dayLiftOf, landInLight, type Daylight } from './hd-daylight'
import {
  accentApartFromSky,
  apartFromSky,
  layerContrastOf,
  type LayerContrast
} from './hd-layer-contrast'
import { lightnessOf, luminanceOf, luminanceOfLightness, withLuminance } from './hd-lightness'
import { backdropMaterialPixel, facingOf, litByFacing, toneRampOf } from './hd-material'
import { GROUND_FLOOR, pushedBackOf } from './hd-readability'
import { hash, mix, mod } from './pixel-canvas'
import { hdSkyOf, skyRowOf, type HdSky } from './scene-hd-sky'
import type { Look } from './scenes/index'

export { hdPlantPixel, hdPondPixel } from './scene-hd-props'
export { hdSkyBaseOf, hdSkyPixel } from './scene-hd-sky'

// hd's land, back to front: far scenery fogged toward the sky, a mid layer of hills, near props, the ground.
// Far and mid come out lit for the hour and kept legible against the sky; props and ground are lit by the caller.

const GROUND_ROWS = 3
const MAX_KEPT = 4
const WINDOW_TICKS = 40
const GLINT_TICKS = 8
// The backdrop skips the material's deepest step: shade, the colour and a highlight are enough.
const BACKDROP_STEP = 1

export type HdFrame = HdSky & {
  scroll: number
  farTops: Float64Array
  midTops: Float64Array
  /** The look's `dayLiftOf`. */
  dayLift: number
  far: LayerContrast
  mid: LayerContrast
  /** The walking strip's tone, already lit. */
  floor: number
}

const farHeight = (look: Look, pixels: number, x: number): number => {
  switch (look.scenery ?? 'peaks') {
    case 'peaks': {
      const i = Math.floor(x / 26)
      let best = 0
      for (let k = i - 1; k <= i + 1; k += 1) {
        const peak = pixels * (0.38 + (hash(k, 5) % 20) / 100)
        best = Math.max(best, peak - Math.abs(x - (k * 26 + (hash(k, 3) % 12))) * 0.75)
      }
      return best
    }
    case 'skyline':
      return mod(x, 7) === 6
        ? pixels * 0.12
        : pixels * (0.22 + (hash(Math.floor(x / 7), 13) % 30) / 100)
    case 'crystals': {
      const i = Math.floor(x / 13)
      let best = 0
      for (let k = i - 1; k <= i + 1; k += 1) {
        const spire = pixels * (0.3 + (hash(k, 19) % 25) / 100)
        best = Math.max(best, spire - Math.abs(x - (k * 13 + (hash(k, 17) % 6))) * 2.2)
      }
      return best
    }
    case 'meadow':
      return pixels * (0.2 + 0.08 * Math.sin(x * 0.07 + 1) + 0.04 * Math.sin(x * 0.19))
  }
}

const midTopOf = (ground: number, pixels: number, mx: number): number =>
  ground - pixels * (0.13 + 0.05 * Math.sin(mx * 0.11 + 2) + 0.03 * Math.sin(mx * 0.29))

/** How far the far range and the hills have scrolled: a sixth and a third of the ground's pace. */
export const hdFarShiftOf = (scroll: number): number => Math.floor(scroll / 6)
export const hdMidShiftOf = (scroll: number): number => Math.floor(scroll / 3)

/** What of the far range moves with the tick: a city's lit windows, a crystal range's glints. */
export const hdFarPhaseOf = (look: Look, tick: number): number =>
  look.scenery === 'skyline'
    ? Math.floor(tick / WINDOW_TICKS)
    : look.scenery === 'crystals'
      ? Math.floor(tick / GLINT_TICKS)
      : 0

const silhouettes = new WeakMap<Look, Map<string, { far: Float64Array; mid: Float64Array }>>()

// Why cached: the silhouettes move only every 3 or 6 ticks of scroll, and not at all at rest.
const silhouettesOf = (sky: HdSky, scroll: number) => {
  const farShift = hdFarShiftOf(scroll)
  const midShift = hdMidShiftOf(scroll)
  const key = `${sky.width}x${sky.pixels}:${farShift}:${midShift}`
  const own =
    silhouettes.get(sky.look) ?? new Map<string, { far: Float64Array; mid: Float64Array }>()
  silhouettes.set(sky.look, own)
  const kept = own.get(key)
  if (kept !== undefined) {
    return kept
  }
  const far = new Float64Array(sky.width + 3)
  const mid = new Float64Array(sky.width + 2)
  for (let x = -1; x <= sky.width + 1; x += 1) {
    far[x + 1] = farHeight(sky.look, sky.pixels, x + farShift)
  }
  // Why one past the edge: the last column's facing reads its right neighbour.
  for (let x = 0; x <= sky.width; x += 1) {
    mid[x] = midTopOf(sky.ground, sky.pixels, x + midShift)
  }
  if (own.size >= MAX_KEPT) {
    own.clear()
  }
  const made = { far, mid }
  own.set(key, made)
  return made
}

type Contrasts = {
  dayLift: number
  far: LayerContrast
  mid: LayerContrast
  /** The walking strip's tone, lit: a floor kept well apart from the hills behind it. */
  floor: number
}

// Room past the floor for the strip's darker seams.
const FLOOR_MARGIN = 5

/** The lightest and darkest the hills can draw on row `y`, from their material's extremes. */
const hillsRangeOf = (args: {
  look: Look
  lit: (color: number) => number
  mid: LayerContrast
  light: Daylight
  pixels: number
  y: number
}): { lo: number; hi: number } => {
  const { look, mid, pixels, y } = args
  const flat = mix(look.near, look.far, 0.35)
  const key = mix(look.sun, 0xffffff, 0.4)
  let lo = 100
  let hi = 0
  for (const tone of toneRampOf(flat).slice(BACKDROP_STEP)) {
    for (const facing of [0, 1]) {
      for (const depth of [0, pixels * 0.21]) {
        const shade = (color: number): number => mix(color, 0x000000, depth * 0.03)
        const hill = shade(litByFacing(tone, facing, key))
        const drawn = apartFromSky(
          pushedBackOf(args.lit(awayFromSky(hill, shade(flat), mid)), args.light),
          mid,
          y
        )
        lo = Math.min(lo, lightnessOf(drawn))
        hi = Math.max(hi, lightnessOf(drawn))
      }
    }
  }
  return { lo, hi }
}

/** The floor's tone: the look's own path colour, moved clear of everything the hills can draw. */
const floorOf = (args: Parameters<typeof hillsRangeOf>[0]): number => {
  const { lo, hi } = hillsRangeOf(args)
  const path = args.lit(mix(args.look.near, args.look.ground, 0.3))
  const own = lightnessOf(path)
  const step = GROUND_FLOOR + FLOOR_MARGIN
  const lighter = hi + step
  const darker = lo - step
  const target =
    own >= lighter || own <= darker
      ? own
      : (own - lo > hi - own && lighter <= 100) || darker < 0
        ? Math.min(100, lighter)
        : darker
  return withLuminance(path, luminanceOfLightness(target))
}

const contrasts = new WeakMap<Look, Map<string, Contrasts>>()

// Why cached: the sides and row floors change only with the size and the quantized hour.
const contrastsOf = (sky: HdSky): Contrasts => {
  const { look, ground, pixels, light } = sky
  const key = `${sky.width}x${pixels}@${ground}:${light.night}:${light.dusk}`
  const own = contrasts.get(look) ?? new Map<string, Contrasts>()
  contrasts.set(look, own)
  const kept = own.get(key)
  if (kept !== undefined) {
    return kept
  }
  const dayLift = dayLiftOf(look)
  const rows = Float64Array.from({ length: ground }, (_, y) => lightnessOf(skyRowOf(sky, y)))
  const lit = (color: number): number => landInLight(color, light, dayLift, look.isNight)
  const middle = skyRowOf(sky, Math.floor(ground * 0.6))
  const mid = layerContrastOf(
    rows,
    lit(mix(look.near, look.far, 0.35)),
    Math.floor(ground - pixels * 0.21)
  )
  const made = {
    dayLift,
    far: layerContrastOf(rows, lit(mix(look.far, middle, 0.33)), Math.floor(ground - pixels * 0.6)),
    mid,
    floor: floorOf({ look, lit, mid, light, pixels, y: ground - 1 })
  }
  if (own.size >= MAX_KEPT) {
    own.clear()
  }
  own.set(key, made)
  return made
}

export const hdFrameOf = (args: {
  look: Look
  width: number
  rows: number
  tick: number
  scroll: number
  light?: Daylight
}): HdFrame => {
  const pixels = args.rows * 2
  const sky = hdSkyOf({ ...args, pixels, ground: pixels - GROUND_ROWS })
  const tops = silhouettesOf(sky, args.scroll)
  return { ...sky, scroll: args.scroll, farTops: tops.far, midTops: tops.mid, ...contrastsOf(sky) }
}

// Why: texture may move a layer only away from the sky; a tone toward it lands on the contrast
// floor, and a moon or sun glow behind it then eats the edge. Luminance orders like L*, minus the cbrt.
const awayFromSky = (textured: number, flat: number, contrast: LayerContrast): number =>
  (luminanceOf(textured) - luminanceOf(flat)) * contrast.side < 0 ? flat : textured

// The sun's tint on the faces that catch it; the hour's darkening comes after, in litOf.
const keyLightOf = (frame: HdFrame): number => mix(frame.look.sun, 0xffffff, 0.4)

const litOf = (frame: HdFrame, color: number): number =>
  landInLight(color, frame.light, frame.dayLift, frame.look.isNight)

const farHeightAt = (frame: HdFrame, x: number): number =>
  frame.farTops[x + 1] ?? farHeight(frame.look, frame.pixels, x + hdFarShiftOf(frame.scroll))

export const hdFarPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const { look, ground, tick, pixels } = frame
  const fx = x + hdFarShiftOf(frame.scroll)
  const height = farHeightAt(frame, x)
  const top = ground - height
  if (y < top) {
    return undefined
  }
  // Why flat for a city: its walls stand straight, and a slope light paints the gaps as lit posts.
  const facing =
    look.scenery === 'skyline'
      ? 0.5
      : facingOf(farHeightAt(frame, x - 1), farHeightAt(frame, x + 1), x, frame.sunX)
  const rock = litByFacing(backdropMaterialPixel(look.far, fx, y, 11), facing, keyLightOf(frame))
  const base = litOf(frame, awayFromSky(rock, look.far, frame.far))
  const snow = litOf(frame, look.snow)
  const layer = (color: number): number =>
    apartFromSky(pushedBackOf(color, frame.light), frame.far, y)
  const accent = (color: number): number => accentApartFromSky(color, frame.far, y)
  const isLitSide = facing > 0.5
  switch (look.scenery ?? 'peaks') {
    case 'peaks':
      if (y - top < 1.6 && height > pixels * 0.45) {
        return accent(litOf(frame, look.snow))
      }
      return layer(base)
    case 'skyline': {
      // Why two pixels tall: a one-pixel window reads as a speck, not a lit room.
      const floor = Math.floor(y / 3)
      const isWindow =
        mod(fx, 7) !== 6 && mod(fx, 2) === 1 && mod(y, 3) !== 2 && floor * 3 > top + 1
      const isLit = isWindow && (hash(fx, floor) + Math.floor(tick / WINDOW_TICKS)) % 10 === 0
      return isLit ? accent(mix(snow, base, 0.15)) : layer(base)
    }
    case 'crystals':
      // Why a rim deeper than the slope, on spires only: a thinner one, or one the hills cut, leaves specks.
      const isRim = y - top < 3 && height > pixels * 0.3
      if (isRim || (hash(fx, Math.floor(y / 2)) + Math.floor(tick / GLINT_TICKS)) % 61 === 0) {
        return accent(mix(snow, base, 0.2))
      }
      return layer(isLitSide ? mix(base, snow, 0.18) : base)
    case 'meadow':
      return layer(base)
  }
}

export const hdMidPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const mx = x + hdMidShiftOf(frame.scroll)
  const top = frame.midTops[x] ?? midTopOf(frame.ground, frame.pixels, mx)
  if (y < top) {
    return undefined
  }
  const heightAt = (at: number): number =>
    frame.ground - (frame.midTops[at] ?? midTopOf(frame.ground, frame.pixels, at + mx - x))
  const facing = facingOf(heightAt(x - 1), heightAt(x + 1), x, frame.sunX)
  const flat = mix(frame.look.near, frame.look.far, 0.35)
  const shade = (color: number): number => mix(color, 0x000000, (y - top) * 0.03)
  const hill = shade(litByFacing(backdropMaterialPixel(flat, mx, y, 23), facing, keyLightOf(frame)))
  const lit = litOf(frame, awayFromSky(hill, shade(flat), frame.mid))
  return apartFromSky(pushedBackOf(lit, frame.light), frame.mid, y)
}

export const hdGroundPixel = (frame: HdFrame, x: number, y: number): number => {
  const { look, ground } = frame
  const gx = x + frame.scroll
  // Why half the material: under the floor, the soil only needs grain, not specks.
  const soil = mix(backdropMaterialPixel(look.ground, gx, y, 61), look.ground, 0.5)
  return mix(soil, 0x000000, (y - ground) * 0.08)
}
