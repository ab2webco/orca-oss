import { dayLiftOf, landInLight, type Daylight } from './hd-daylight'
import {
  accentApartFromSky,
  apartFromSky,
  layerContrastOf,
  type LayerContrast
} from './hd-layer-contrast'
import { lightnessOf } from './hd-lightness'
import { hash, mix, mod } from './pixel-canvas'
import { hdSkyOf, hdSkyPixel, skyRowOf, type HdSky } from './scene-hd-sky'
import type { Look } from './scenes/index'

export { hdSkyBaseOf, hdSkyPixel } from './scene-hd-sky'

// hd's land, back to front: far scenery fogged toward the sky, a mid layer of hills, near props, the ground.
// Far and mid come out lit for the hour and kept legible against the sky; props and ground are lit by the caller.

const GROUND_ROWS = 3
const PLANT_EVERY = 19
const TRUNK = 0x3e2c1f
const BEACON = 0xff4a4a
const BEACON_OFF = 0x5a1a1a
const WATER = 0x1f4f8f
const MAX_KEPT = 4

export type HdFrame = HdSky & {
  scroll: number
  farTops: Float64Array
  midTops: Float64Array
  /** The look's `dayLiftOf`. */
  dayLift: number
  far: LayerContrast
  mid: LayerContrast
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

const silhouettes = new WeakMap<Look, Map<string, { far: Float64Array; mid: Float64Array }>>()

// Why cached: the silhouettes move only every 3 or 6 ticks of scroll, and not at all at rest.
const silhouettesOf = (sky: HdSky, scroll: number) => {
  const farShift = Math.floor(scroll / 6)
  const midShift = Math.floor(scroll / 3)
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
  for (let x = 0; x < sky.width; x += 1) {
    mid[x] = midTopOf(sky.ground, sky.pixels, x + midShift)
  }
  if (own.size >= MAX_KEPT) {
    own.clear()
  }
  const made = { far, mid }
  own.set(key, made)
  return made
}

type Contrasts = { dayLift: number; far: LayerContrast; mid: LayerContrast }

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
  const made = {
    dayLift,
    far: layerContrastOf(rows, lit(mix(look.far, middle, 0.33)), Math.floor(ground - pixels * 0.6)),
    mid: layerContrastOf(
      rows,
      lit(mix(look.near, look.far, 0.35)),
      Math.floor(ground - pixels * 0.21)
    )
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

const litOf = (frame: HdFrame, color: number): number =>
  landInLight(color, frame.light, frame.dayLift, frame.look.isNight)

const skyAt = (frame: HdFrame, y: number): number =>
  mix(frame.look.skyTop, frame.look.skyBottom, Math.min(1, y / Math.max(1, frame.ground - 1)))

const farHeightAt = (frame: HdFrame, x: number): number =>
  frame.farTops[x + 1] ?? farHeight(frame.look, frame.pixels, x + Math.floor(frame.scroll / 6))

export const hdFarPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const { look, ground, tick, pixels } = frame
  const fx = x + Math.floor(frame.scroll / 6)
  const height = farHeightAt(frame, x)
  const top = ground - height
  if (y < top) {
    return undefined
  }
  const fogged = mix(look.far, skyAt(frame, y), 0.42 - ((y - top) / Math.max(1, height)) * 0.18)
  const base = litOf(frame, fogged)
  const snow = litOf(frame, look.snow)
  const layer = (color: number): number => apartFromSky(color, frame.far, y)
  const accent = (color: number): number => accentApartFromSky(color, frame.far, y)
  const isLitSide = farHeightAt(frame, x + 1) < height
  switch (look.scenery ?? 'peaks') {
    case 'peaks':
      if (y - top < 1.6 && height > pixels * 0.45) {
        return accent(litOf(frame, mix(look.snow, skyAt(frame, y), 0.15)))
      }
      return layer(isLitSide ? mix(base, 0xffffff, 0.08) : base)
    case 'skyline': {
      const isWindow = mod(fx, 7) !== 6 && mod(fx, 2) === 1 && mod(y, 2) === 0 && y > top + 1
      const isLit = isWindow && (hash(fx, y) + Math.floor(tick / 40)) % 3 === 0
      return isLit ? accent(mix(snow, base, 0.15)) : layer(base)
    }
    case 'crystals':
      if (y - top < 1 || (hash(fx, y) + Math.floor(tick / 8)) % 23 === 0) {
        return accent(mix(snow, base, 0.2))
      }
      return layer(isLitSide ? mix(base, snow, 0.18) : base)
    case 'meadow':
      return layer(base)
  }
}

export const hdMidPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const mx = x + Math.floor(frame.scroll / 3)
  const top = frame.midTops[x] ?? midTopOf(frame.ground, frame.pixels, mx)
  if (y < top) {
    return undefined
  }
  const fleck = hash(mx, y) % 7 === 0 ? 0.08 : 0
  const hill = mix(mix(frame.look.near, frame.look.far, 0.35), 0x000000, fleck + (y - top) * 0.03)
  return apartFromSky(litOf(frame, hill), frame.mid, y)
}

export const hdPlantPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const { look, ground } = frame
  const px = x + Math.floor(frame.scroll / 1.5)
  if (look.plantKind === 'none' || hash(Math.floor(px / PLANT_EVERY), 9) % 3 === 0) {
    return undefined
  }
  const slot = mod(px, PLANT_EVERY)
  const h = ground - 1 - y
  const lit = slot < 9 ? 0.12 : 0
  switch (look.plantKind) {
    case 'tree':
      if (slot === 9 && h >= 0 && h < 2) {
        return TRUNK
      }
      return h >= 2 && h < 11 && Math.abs(slot - 9) <= (8 - h * 0.7) / 2
        ? mix(mix(look.plant, 0xffffff, lit), 0x000000, h % 3 === 2 ? 0.12 : 0)
        : undefined
    case 'cactus': {
      if (slot === 9 && h >= 0 && h < 8) {
        return mix(look.plant, 0xffffff, lit)
      }
      const isArm =
        (slot === 7 && h >= 3 && h < 6) ||
        (slot === 8 && h === 3) ||
        (slot === 11 && h >= 4 && h < 7) ||
        (slot === 10 && h === 4)
      return isArm ? look.plant : undefined
    }
    case 'antenna':
      if (slot === 9 && h >= 0 && h < 8) {
        return look.plant
      }
      return slot === 9 && h === 8
        ? Math.floor(frame.tick / 6) % 2 === 0
          ? BEACON
          : BEACON_OFF
        : undefined
    case 'crystal':
      return h >= 0 && h < 7 && Math.abs(slot - 9) <= (7 - h) * 0.45
        ? mix(look.plant, 0xffffff, slot <= 9 ? 0.25 : 0)
        : undefined
    case 'flower':
      if (h === 0 && (slot === 4 || slot === 12)) {
        return mix(look.near, 0x000000, 0.2)
      }
      return h === 1 && (slot === 4 || slot === 12) ? look.plant : undefined
  }
}

export const hdGroundPixel = (frame: HdFrame, x: number, y: number): number => {
  const { look, ground } = frame
  const gx = x + frame.scroll
  if (y === ground) {
    return hash(gx, 1) % 4 === 0 ? mix(look.near, 0xffffff, 0.2) : mix(look.near, look.ground, 0.25)
  }
  const roll = hash(gx, y)
  if (roll % 13 === 0) {
    return mix(look.ground, 0xffffff, 0.12)
  }
  return mix(look.ground, 0x000000, (roll % 9 === 0 ? 0.25 : 0) + (y - ground) * 0.08)
}

/** A pond on the ground line that mirrors the sky, outside the city. */
export const hdPondPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const px = mod(x + Math.floor(frame.scroll / 1.5), 97)
  if (frame.look.scenery === 'skyline' || px < 64 || px >= 86 || y < frame.ground - 1) {
    return undefined
  }
  if (y > frame.ground) {
    return undefined
  }
  const mirror = hdSkyPixel(frame, x, Math.max(0, frame.ground - 5 - (y - frame.ground + 1) * 3))
  const ripple = hash(x + Math.floor(frame.tick / 3), y) % 7 === 0 ? -0.2 : 0
  return mix(mirror, WATER, 0.4 + ripple)
}
