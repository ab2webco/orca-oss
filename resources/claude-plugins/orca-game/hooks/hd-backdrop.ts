import { landInLight } from './hd-daylight'
import { hdBakedGroundOf, hdBakedLandOf, type HdLandBake } from './hd-land-bake'
import { lightnessOf, luminanceOfLightness, withLuminance } from './hd-lightness'
import { GROUND_FLOOR } from './hd-readability'
import { mix, mod } from './pixel-canvas'
import { hdGroundPixel, hdPlantPixel, hdPondPixel, hdSkyPixel, type HdFrame } from './scene-hd-land'

// What shows behind the figures, front to back: a pond, the ground, plants, the land and the sky.

// Why seams: a long flat strip reads as a stripe; a faint joint every few pixels reads as a path.
const SEAM_EVERY = 7

/** The walking strip at column x: the frame's floor tone, moved apart from the land right behind it. */
export const hdFloorPixel = (frame: HdFrame, land: HdLandBake, x: number): number => {
  const gx = x + frame.scroll
  const base = mod(gx, SEAM_EVERY) === 0 ? mix(frame.floor, 0x000000, 0.08) : frame.floor
  const behind =
    hdBakedLandOf(land, frame, x, frame.ground - 1) ?? hdSkyPixel(frame, x, frame.ground - 1)
  const own = lightnessOf(base)
  const back = lightnessOf(behind)
  if (Math.abs(own - back) >= GROUND_FLOOR) {
    return base
  }
  const lighter = back + GROUND_FLOOR + 1
  const target =
    (own >= back && lighter <= 100) || back < GROUND_FLOOR + 1 ? lighter : back - GROUND_FLOOR - 1
  return withLuminance(base, luminanceOfLightness(Math.min(100, target)))
}

/** The backdrop at (x, y), lit for the hour; `shade` darkens the ground under a figure's feet. */
export const hdBackdropPixel = (
  frame: HdFrame,
  land: HdLandBake,
  x: number,
  y: number,
  shade = 0
): number => {
  const pond = hdPondPixel(frame, x, y)
  if (pond !== undefined) {
    return pond
  }
  const { look } = frame
  if (y === frame.ground) {
    return mix(hdFloorPixel(frame, land, x), 0x000000, shade)
  }
  if (y > frame.ground) {
    if (shade === 0) {
      return hdBakedGroundOf(land, frame, x, y)
    }
    const soil = mix(hdGroundPixel(frame, x, y), 0x000000, shade)
    return landInLight(soil, frame.light, frame.dayLift, look.isNight)
  }
  const plant = hdPlantPixel(frame, x, y)
  if (plant !== undefined) {
    return landInLight(plant, frame.light, frame.dayLift, look.isNight)
  }
  return hdBakedLandOf(land, frame, x, y) ?? hdSkyPixel(frame, x, y)
}
