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
