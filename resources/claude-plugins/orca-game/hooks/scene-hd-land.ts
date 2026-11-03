import { dayLiftOf, landInLight, type Daylight } from './hd-daylight'
import {
  accentApartFromSky,
  apartFromSky,
  layerContrastOf,
  rimApartFromSky,
  type LayerContrast
} from './hd-layer-contrast'
import { lightnessOf, luminanceOf, luminanceOfLightness, withLuminance } from './hd-lightness'
import { backdropMaterialPixel, facingOf, litByFacing, toneRampOf } from './hd-material'
import { GROUND_FLOOR, pushedBackOf } from './hd-readability'
import { hash, mix, mod } from './pixel-canvas'
import { hdHillDetailOf, hdMarkPixelOf, WARM_WINDOW } from './scene-hd-depth'
import { hdGroundDetailOf } from './hd-ground-detail'
import { hdFarHeightOf, hdMidTopOf } from './hd-land-heights'
import { hdSkyOf, skyRowOf, type HdSky } from './scene-hd-sky'
import type { Look } from './scenes/index'

export { hdPlantPixel, hdPondPixel } from './scene-hd-props'
export { hdSkyBaseOf, hdSkyPixel } from './scene-hd-sky'

// hd's land, back to front: a hazy distant range, far scenery with its landmark, hills, near props, the ground.
// Far and mid come out lit for the hour and kept legible against the sky; props and ground are lit by the caller.

const GROUND_ROWS = 3
const MAX_KEPT = 4
const WINDOW_TICKS = 40
const GLINT_TICKS = 8
// Lightness a rolling range's rim keeps off the sky behind it.
const RIM_GAP = 16
// The backdrop skips the material's deepest step: shade, the colour and a highlight are enough.
const BACKDROP_STEP = 1
// The hills' own colour leans to the near tone and darkens with each row down.
const MID_TONE = 0.2
const MID_SHADE = 0.045

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

/** How far the far range and the hills have scrolled: a quarter and a half of the ground's pace. */
export const hdFarShiftOf = (scroll: number): number => Math.floor(scroll / 4)
export const hdMidShiftOf = (scroll: number): number => Math.floor(scroll / 2)

/** What of the far range moves with the tick: lit windows and glints. */
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
    far[x + 1] = hdFarHeightOf(sky.look, sky.pixels, x + farShift)
  }
  // Why one past the edge: the last column's facing reads its right neighbour.
  for (let x = 0; x <= sky.width; x += 1) {
    mid[x] = hdMidTopOf(sky.look, sky.ground, sky.pixels, x + midShift)
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
  const flat = mix(look.near, look.far, MID_TONE)
  const key = mix(look.sun, 0xffffff, 0.4)
  let lo = 100
  let hi = 0
  for (const tone of toneRampOf(flat).slice(BACKDROP_STEP)) {
    for (const facing of [0, 1]) {
      for (const depth of [0, pixels * 0.29]) {
        const shade = (color: number): number => mix(color, 0x000000, depth * MID_SHADE)
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
    lit(mix(look.near, look.far, MID_TONE)),
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
  frame.farTops[x + 1] ?? hdFarHeightOf(frame.look, frame.pixels, x + hdFarShiftOf(frame.scroll))

/** The landmark standing on the hills at (x, y), lit like them; undefined off it. */
export const hdMarkPixel = (frame: HdFrame, x: number, y: number): number | undefined =>
  hdMarkPixelOf(
    frame,
    x + hdMidShiftOf(frame.scroll),
    y,
    (at) => frame.ground - hdMidTopOf(frame.look, frame.ground, frame.pixels, at)
  )

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
  // Why a lit ridge on every range: its edge, not its fill, is what tells it from the haze behind.
  const isRidge = y - top < 2 && !(look.scenery === 'skyline' && mod(fx, 7) === 6)
  if (
    isRidge &&
    look.scenery !== 'crystals' &&
    look.scenery !== undefined &&
    look.scenery !== 'peaks'
  ) {
    // Why the key light, not the look's snow: a dusk palette's snow is as dim as its rock.
    // Why brighter and stronger in the country: rolling hills have no snow cap, and a sunset rim
    // as light as the sky behind it vanishes.
    const isMeadow = look.scenery === 'meadow'
    const rim = isMeadow ? mix(look.sun, 0xffffff, 0.7) : keyLightOf(frame)
    // Why the range's flat colour: its grain under a rim breaks the edge into specks.
    const reach = (isLitSide ? 0.6 : 0.4) + (isMeadow ? 0.25 : 0)
    const lit = mix(litOf(frame, look.far), litOf(frame, rim), reach)
    return isMeadow ? rimApartFromSky(lit, frame.far, y, RIM_GAP) : accent(lit)
  }
  switch (look.scenery ?? 'peaks') {
    case 'peaks':
      // Why every peak capped two deep: a thinner cap on a slope breaks into single pixels.
      if (isRidge) {
        return accent(isLitSide ? snow : mix(snow, litOf(frame, look.far), 0.3))
      }
      return layer(base)
    case 'skyline': {
      // Why two pixels tall: a one-pixel window reads as a speck, not a lit room.
      const floor = Math.floor(y / 3)
      const isWindow =
        mod(fx, 7) !== 6 && mod(fx, 2) === 1 && mod(y, 3) !== 2 && floor * 3 >= top + 2
      const isLit = isWindow && (hash(fx, floor) + Math.floor(tick / WINDOW_TICKS)) % 4 === 0
      return isLit ? accent(litOf(frame, mix(WARM_WINDOW, snow, 0.35))) : layer(base)
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
  const { look } = frame
  const mx = x + hdMidShiftOf(frame.scroll)
  const mark = hdMarkPixel(frame, x, y)
  if (mark !== undefined) {
    return mark
  }
  const top = frame.midTops[x] ?? hdMidTopOf(look, frame.ground, frame.pixels, mx)
  const flat = mix(look.near, look.far, MID_TONE)
  const drawn = (color: number): number =>
    apartFromSky(pushedBackOf(litOf(frame, color), frame.light), frame.mid, y)
  if (y < top) {
    const detail = hdHillDetailOf(look, mx, Math.ceil(top) - 1 - y)
    if (detail === undefined) {
      return undefined
    }
    const tone = detail === 'leaf' ? mix(flat, look.plant, 0.45) : mix(flat, look.snow, 0.4)
    return drawn(mix(tone, 0x000000, detail === 'leaf' ? 0.2 : 0))
  }
  // Why both rows inside the roof: a one-pixel window reads as a speck, not a lit room.
  const sill = y - mod(y, 4)
  const isRoofWindow =
    look.scenery === 'skyline' &&
    frame.light.night > 0.5 &&
    sill - top > 1 &&
    sill + 1 < frame.ground &&
    mod(mx, 6) % 3 === 1 &&
    mod(y, 4) < 2 &&
    hash(mx, Math.floor(y / 4)) % 3 === 0
  if (isRoofWindow) {
    return accentApartFromSky(WARM_WINDOW, frame.mid, y)
  }
  const heightAt = (at: number): number =>
    frame.ground - (frame.midTops[at] ?? hdMidTopOf(look, frame.ground, frame.pixels, at + mx - x))
  const facing =
    look.scenery === 'skyline' ? 0.5 : facingOf(heightAt(x - 1), heightAt(x + 1), x, frame.sunX)
  if (y - top < 1) {
    return drawn(mix(flat, keyLightOf(frame), 0.4))
  }
  const shade = (color: number): number => mix(color, 0x000000, (y - top) * MID_SHADE)
  const hill = shade(litByFacing(backdropMaterialPixel(flat, mx, y, 23), facing, keyLightOf(frame)))
  return drawn(awayFromSky(hill, shade(flat), frame.mid))
}

export const hdGroundPixel = (frame: HdFrame, x: number, y: number): number => {
  const { look, ground } = frame
  const gx = x + frame.scroll
  // Why half the material: under the floor, the soil only needs grain, not specks.
  const soil = mix(backdropMaterialPixel(look.ground, gx, y, 61), look.ground, 0.5)
  return mix(hdGroundDetailOf(look, gx, y - ground, soil) ?? soil, 0x000000, (y - ground) * 0.08)
}
