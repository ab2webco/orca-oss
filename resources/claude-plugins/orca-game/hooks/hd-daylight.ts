import { mix } from './pixel-canvas'

// How dark and how orange the hd scene is: 0 at noon, 1 deep in the night; dusk peaks at 6 and 18.

const NIGHT_TOP = 0x0b1030
const NIGHT_BOTTOM = 0x1f2f5c
const DUSK = 0xff9a5a
const NIGHT_LAND = 0x05070f

export type Daylight = { night: number; dusk: number }

export const NOON: Daylight = { night: 0, dusk: 0 }

export const skyAtNight = (color: number, y: number, ground: number, light: Daylight): number => {
  const depth = y / Math.max(1, ground - 1)
  const dark = mix(color, mix(NIGHT_TOP, NIGHT_BOTTOM, depth), light.night * 0.85)
  return light.dusk > 0 ? mix(dark, DUSK, light.dusk * 0.3 * depth) : dark
}

export const landAtNight = (color: number, light: Daylight): number => {
  if (light.night === 0 && light.dusk === 0) {
    return color
  }
  const dark = mix(color, NIGHT_LAND, light.night * 0.45)
  return light.dusk > 0 ? mix(dark, DUSK, light.dusk * 0.12) : dark
}

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
