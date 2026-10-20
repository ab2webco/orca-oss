// three's Lambert lighting as plain numbers, so ogl and pixi light the land from the same values.
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import { DEPTH, SAMPLES } from './hd2d-layout'
import type { Hd2dWorld } from './hd2d-world'

export type Rgb = readonly [number, number, number]

export type Hd2dLights = {
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  sunColor: number
  sunIntensity: number
  /** Unit vector toward the sun; constant because the light travels with the camera. */
  sunDirection: Rgb
}

/** Offset of the sun light from the camera, in world units. */
export const sunOffsetOf = (world: Hd2dWorld): Rgb => [
  (world.sun.x / SAMPLES - 0.5) * 260,
  160,
  DEPTH + 60
]

export const lightsOf = (world: Hd2dWorld): Hd2dLights => {
  const night = world.night
  const [x, y, z] = sunOffsetOf(world)
  const length = Math.hypot(x, y, z)
  return {
    hemiSky: mix(world.sky[0] ?? 0xffffff, 0xffffff, 0.35 + night * 0.3),
    hemiGround: world.soil,
    // Why a high floor: the mod keeps figures readable after dark, and so must the billboards.
    hemiIntensity: 1.1 + (1 - night) * 0.3,
    sunColor: mix(world.sun.color, 0xffffff, 0.45),
    sunIntensity: 0.2 + (1 - night) * 1.6,
    sunDirection: [x / length, y / length, z / length]
  }
}

const toLinear = (c: number): number =>
  c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4
const toSrgb = (c: number): number => (c < 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055)

export const linearOf = (hex: number): Rgb => [
  toLinear(((hex >> 16) & 255) / 255),
  toLinear(((hex >> 8) & 255) / 255),
  toLinear((hex & 255) / 255)
]

export const srgbHexOf = (rgb: Rgb): number => {
  const channel = (c: number): number => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
  return (channel(rgb[0]) << 16) | (channel(rgb[1]) << 8) | channel(rgb[2])
}

/** Linear diffuse colour lit by the hemisphere and sun, as three's Lambert material does. */
export const lambertOf = (diffuse: Rgb, normal: Rgb, lights: Hd2dLights): Rgb => {
  const sky = linearOf(lights.hemiSky)
  const ground = linearOf(lights.hemiGround)
  const sun = linearOf(lights.sunColor)
  const w = 0.5 * normal[1] + 0.5
  const [dx, dy, dz] = lights.sunDirection
  const cos = Math.max(0, normal[0] * dx + normal[1] * dy + normal[2] * dz)
  const at = (k: 0 | 1 | 2): number =>
    (diffuse[k] *
      ((ground[k] * (1 - w) + sky[k] * w) * lights.hemiIntensity +
        sun[k] * lights.sunIntensity * cos)) /
    Math.PI
  return [at(0), at(1), at(2)]
}

/** A soft ground ellipse from a member's feet to where its top's shadow lands; centre and size. */
export const shadowBlobOf = (
  at: number,
  height: number,
  width: number,
  sunDirection: Rgb
): { x: number; z: number; width: number; length: number } => {
  const [dx, dy, dz] = sunDirection
  const lift = Math.max(0.1, dy)
  const length = (height * dz) / lift
  return { x: at - (height * dx) / lift / 2, z: -length / 2, width: width * 0.9, length }
}
