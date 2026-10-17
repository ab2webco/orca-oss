import { lightnessOf } from './hd-lightness'
import { mix } from './pixel-canvas'
import type { Look } from './scenes/index'

// How dark and how orange the hd scene is: 0 at noon, 1 deep in the night; dusk peaks at 6 and 18.
// A look authored dark (Vigilante's city, a red alert) is lifted toward an overcast day by daylight;
// one authored as night is its own midnight.

const NIGHT_TOP = 0x070b24
const NIGHT_BOTTOM = 0x1a2852
const DUSK = 0xff9a5a
const NIGHT_LAND = 0x05070f
const NIGHT_CLOUD = 0x252c48
const DAY_TOP = 0x86a9d4
const DAY_BOTTOM = 0xdfe4e6
const DAY_LAND = 0x8c98aa
const DAY_FLOOR = 56
const MAX_LIFT = 0.5
const LAND_LIFT = 0.6

export type Daylight = { night: number; dusk: number }

export const NOON: Daylight = { night: 0, dusk: 0 }
export const MIDNIGHT: Daylight = { night: 1, dusk: 0 }

const lifts = new WeakMap<Look, number>()

/** How far noon mixes a look's sky toward day: a night look the most, a bright one not at all. */
export const dayLiftOf = (look: Look): number => {
  const kept = lifts.get(look)
  if (kept !== undefined) {
    return kept
  }
  const authored = (lightnessOf(look.skyTop) + lightnessOf(look.skyBottom)) / 2
  const day = (lightnessOf(DAY_TOP) + lightnessOf(DAY_BOTTOM)) / 2
  const made = look.isNight
    ? MAX_LIFT
    : Math.max(0, Math.min(MAX_LIFT, (DAY_FLOOR - authored) / Math.max(1, day - authored)))
  lifts.set(look, made)
  return made
}

export const skyInLight = (
  color: number,
  y: number,
  ground: number,
  light: Daylight,
  look: Look
): number => {
  const depth = y / Math.max(1, ground - 1)
  const lift = (1 - light.night) * dayLiftOf(look)
  const day = lift > 0 ? mix(color, mix(DAY_TOP, DAY_BOTTOM, depth), lift) : color
  const lit = look.isNight ? day : mix(day, mix(NIGHT_TOP, NIGHT_BOTTOM, depth), light.night * 0.9)
  return light.dusk > 0 ? mix(lit, DUSK, light.dusk * 0.3 * depth) : lit
}

/** Land, ground and figures in this light; `lift` is the look's `dayLiftOf`, 0 for figures. */
export const landInLight = (
  color: number,
  light: Daylight,
  lift = 0,
  isNightLook = false
): number => {
  const day =
    lift > 0 && light.night < 1 ? mix(color, DAY_LAND, (1 - light.night) * lift * LAND_LIFT) : color
  if (isNightLook || (light.night === 0 && light.dusk === 0)) {
    return day
  }
  const dark = mix(day, NIGHT_LAND, light.night * 0.45)
  return light.dusk > 0 ? mix(dark, DUSK, light.dusk * 0.12) : dark
}

/** Clouds dim with the night sky instead of staying daylight white. */
export const cloudInLight = (color: number, light: Daylight, isNightLook: boolean): number =>
  isNightLook
    ? mix(color, 0xffffff, (1 - light.night) * 0.4)
    : mix(color, NIGHT_CLOUD, light.night * 0.6)

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>()

const zoneFormatOf = (zone: string): Intl.DateTimeFormat | null => {
  const kept = zoneFormats.get(zone)
  if (kept !== undefined) {
    return kept
  }
  let made: Intl.DateTimeFormat | null = null
  try {
    made = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23'
    })
  } catch {
    made = null
  }
  zoneFormats.set(zone, made)
  return made
}

/** The hour, with minutes as a fraction, in an IANA zone; `local` or an unknown zone is the machine's. */
export const hourOf = (epochMs: number, zone: string): number => {
  const format = zone === 'local' ? null : zoneFormatOf(zone)
  if (format === null) {
    const date = new Date(epochMs)
    return date.getHours() + date.getMinutes() / 60
  }
  const parts = format.formatToParts(epochMs)
  const part = (type: string): number => Number(parts.find((one) => one.type === type)?.value ?? 0)
  return (part('hour') % 24) + part('minute') / 60
}

export const nightnessOf = (hour: number): number => {
  if (hour >= 19 || hour < 5) {
    return 1
  }
  if (hour >= 7 && hour < 17) {
    return 0
  }
  return hour < 7 ? 1 - (hour - 5) / 2 : (hour - 17) / 2
}

export const duskOf = (hour: number): number =>
  Math.max(0, 1 - Math.min(Math.abs(hour - 6), Math.abs(hour - 18)) / 1.5)

export const daylightAt = (hour: number): Daylight => ({
  night: nightnessOf(hour),
  dusk: duskOf(hour)
})
