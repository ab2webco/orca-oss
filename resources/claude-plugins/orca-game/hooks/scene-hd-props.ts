import { hash, mix, mod } from './pixel-canvas'
import type { HdFrame } from './scene-hd-land'
import type { Look } from './scenes/index'
import { hdSkyPixel } from './scene-hd-sky'

// hd's props on the ground line: a plant every few columns and a pond mirroring the sky.

export const PLANT_EVERY = 19
const TRUNK = 0x3e2c1f
const BEACON = 0xff4a4a
const BEACON_OFF = 0x5a1a1a
const WATER = 0x1f4f8f

export const hdPlantPixel = (frame: HdFrame, x: number, y: number): number | undefined => {
  const { look, ground } = frame
  const px = x + Math.floor(frame.scroll / 1.5)
  if (look.plantKind === 'none' || hash(Math.floor(px / PLANT_EVERY), 9) % 3 === 0) {
    return undefined
  }
  return hdPlantShapePixel(look, mod(px, PLANT_EVERY), ground - 1 - y, frame.tick)
}

/** One plant's colour at `slot` of its PLANT_EVERY columns, `h` pixels above the ground line. */
export const hdPlantShapePixel = (
  look: Look,
  slot: number,
  h: number,
  tick: number
): number | undefined => {
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
        ? Math.floor(tick / 6) % 2 === 0
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
    case 'none':
      return undefined
  }
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
  const ripple = hash(x + Math.floor(frame.tick / 3), y) % 19 === 0 ? -0.2 : 0
  return mix(mirror, WATER, 0.4 + ripple)
}
