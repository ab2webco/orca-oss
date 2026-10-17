import { cloudInLight, MIDNIGHT, NOON, skyInLight, type Daylight } from './hd-daylight'
import { hash, mix } from './pixel-canvas'
import type { Look } from './scenes/index'

// hd's sky: a cached gradient with the sun or moon and its glow, then drifting clouds, light shafts and stars.

const STAR = 0xf5f3c8
const MOON = 0xe8ecff
const DAY_SUN = 0xfff2c8
const SIGNAL_EMBLEM = 0x1c1f2b
const MAX_KEPT = 6

export type SkyLayer = { color: Uint32Array; isDisc: Uint8Array }

/** One hd frame's tick-free geometry and its cached sky. */
export type HdSky = {
  look: Look
  width: number
  pixels: number
  ground: number
  tick: number
  light: Daylight
  sunX: number
  sunY: number
  sunR: number
  /** The clouds' colour in this light. */
  cloud: number
  sky: SkyLayer
}

const gradientOf = (frame: Omit<HdSky, 'sky'>, y: number): number =>
  mix(frame.look.skyTop, frame.look.skyBottom, Math.min(1, y / Math.max(1, frame.ground - 1)))

const isNightOf = (frame: Pick<HdSky, 'light'>): boolean => frame.light.night > 0.5

// A night look keeps its own moon (or signal) after dark and shows a sun by day.
const discOf = (frame: Omit<HdSky, 'sky'>): number => {
  if (isNightOf(frame)) {
    return frame.look.isNight ? frame.look.sun : MOON
  }
  return frame.look.isNight ? DAY_SUN : frame.look.sun
}

const staticSkyOf = (frame: Omit<HdSky, 'sky'>, x: number, y: number) => {
  const { look, sunX, sunY, sunR } = frame
  const color = skyInLight(gradientOf(frame, y), y, frame.ground, frame.light, look)
  const light = discOf(frame)
  const isSignal = look.isSignal === true && isNightOf(frame)
  const d = Math.hypot(x - sunX, (y - sunY) * 1.05)
  const isBeam = isSignal && y > sunY && Math.abs(x - (sunX - (y - sunY) * 1.4)) <= 1.2
  const beamed = isBeam ? mix(color, look.sun, 0.35) : color
  if (d <= sunR) {
    const isEmblem = isSignal && Math.abs(x - sunX) <= 1 && Math.abs(y - sunY) <= 0.6
    return { color: isEmblem ? SIGNAL_EMBLEM : light, isDisc: true }
  }
  const glow = d <= sunR * 2.8 ? (1 - (d - sunR) / (sunR * 1.8)) ** 2 * 0.42 : 0
  return { color: glow > 0 ? mix(beamed, light, glow) : beamed, isDisc: false }
}

const layers = new WeakMap<Look, Map<string, SkyLayer>>()

// Why quantized: a fractional nightness at dawn would miss the cache on every frame.
const quantize = (value: number): number => Math.round(value * 8) / 8

export const hdSkyOf = (args: {
  look: Look
  width: number
  pixels: number
  ground: number
  tick: number
  light?: Daylight
}): HdSky => {
  const light = args.light ?? (args.look.isNight ? MIDNIGHT : NOON)
  const steady = { night: quantize(light.night), dusk: quantize(light.dusk) }
  const base = {
    ...args,
    light: steady,
    cloud: cloudInLight(args.look.cloud, steady, args.look.isNight),
    sunX: args.width - 16,
    sunY: args.pixels * 0.24,
    sunR: Math.max(2.2, args.pixels * 0.11)
  }
  const key = `${args.width}x${args.pixels}@${args.ground}:${steady.night}:${steady.dusk}`
  const own = layers.get(args.look) ?? new Map<string, SkyLayer>()
  layers.set(args.look, own)
  const kept = own.get(key)
  if (kept !== undefined) {
    return { ...base, sky: kept }
  }
  const color = new Uint32Array(args.width * args.pixels)
  const isDisc = new Uint8Array(args.width * args.pixels)
  for (let y = 0; y < args.pixels; y += 1) {
    for (let x = 0; x < args.width; x += 1) {
      const one = staticSkyOf(base, x, y)
      color[y * args.width + x] = one.color
      isDisc[y * args.width + x] = one.isDisc ? 1 : 0
    }
  }
  if (own.size >= MAX_KEPT) {
    own.clear()
  }
  const sky = { color, isDisc }
  own.set(key, sky)
  return { ...base, sky }
}

/** The sky without anything that moves: gradient, sun or moon and glow. */
export const hdSkyBaseOf = (frame: HdSky, x: number, y: number): number => {
  const inside = x >= 0 && x < frame.width && y >= 0 && y < frame.pixels
  return inside ? (frame.sky.color[y * frame.width + x] ?? 0) : staticSkyOf(frame, x, y).color
}

const smooth = (x: number, seed: number, every: number): number => {
  const i = Math.floor(x / every)
  const t = x / every - i
  const a = (hash(i, seed) % 1000) / 1000
  const b = (hash(i + 1, seed) % 1000) / 1000
  return a + (b - a) * t * t * (3 - 2 * t)
}

/** A slanted band of sunlight, 0 to 1. */
export const shaftOf = (x: number, y: number, sunX: number, tick: number): number => {
  const band = (((x - sunX + y * 1.15 - tick * 0.04) % 19) + 19) % 19
  return band < 2.5 ? 1 - band / 2.5 : 0
}

export const hdSkyPixel = (frame: HdSky, x: number, y: number): number => {
  const inside = x >= 0 && x < frame.width && y >= 0 && y < frame.pixels
  if (inside && frame.sky.isDisc[y * frame.width + x] === 1) {
    return frame.sky.color[y * frame.width + x] ?? 0
  }
  const { look, tick, pixels } = frame
  let color = hdSkyBaseOf(frame, x, y)
  if (!isNightOf(frame)) {
    color = mix(color, look.sun, shaftOf(x, y, frame.sunX, tick) * 0.1)
  }
  const band = (centre: number, every: number, seed: number, drift: number): number => {
    const lump = smooth(x + Math.floor(tick / drift), seed, every)
    const thick = lump > 0.55 ? (lump - 0.55) * 7 : 0
    return Math.abs(y - centre) <= thick ? (y < centre ? 1 : 0.6) : 0
  }
  const cloud = Math.max(band(pixels * 0.14, 9, 31, 12), band(pixels * 0.3, 13, 37, 18))
  if (cloud > 0) {
    color = mix(color, frame.cloud, cloud === 1 ? 0.92 : 0.6)
  }
  const isStar = isNightOf(frame) && y < frame.ground * 0.55 && hash(x, y) % 41 === 0
  return isStar && (hash(x, y) + Math.floor(tick / 6)) % 5 !== 0 ? STAR : color
}
