import { describe, expect, it } from 'vitest'
import { daylightAt } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { SAMPLES } from './hd2d-layout'
import { lambertOf, lightsOf, linearOf, shadowBlobOf, srgbHexOf } from './hd2d-lighting'
import { hd2dWorldOf } from './hd2d-world'

describe('hd2d lighting', () => {
  it('round-trips sRGB through linear', () => {
    expect(linearOf(0xffffff)).toEqual([1, 1, 1])
    expect(linearOf(0x808080)[0]).toBeCloseTo(0.2158605, 5)
    expect(srgbHexOf(linearOf(0x8ccaf5))).toBe(0x8ccaf5)
  })

  it('takes its lights from the world, brighter by day', () => {
    const noon = lightsOf(hd2dWorldOf(QUEST_SCENE, 120, daylightAt(12)))
    const night = lightsOf(hd2dWorldOf(QUEST_SCENE, 120, daylightAt(0)))
    expect(noon.hemiIntensity).toBeCloseTo(1.4)
    expect(night.hemiIntensity).toBeCloseTo(1.1)
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity)
  })

  it('aims the sun from its column, above and in front of the band', () => {
    const world = hd2dWorldOf(QUEST_SCENE, 120, daylightAt(12))
    const [x, y, z] = lightsOf(world).sunDirection
    const offset = (world.sun.x / SAMPLES - 0.5) * 260
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(x / y).toBeCloseTo(offset / 160)
    expect(z / y).toBeCloseTo(140 / 160)
  })

  it('lights like three lambert: (hemi + sun * cos) / pi', () => {
    const lights = {
      hemiSky: 0xffffff,
      hemiGround: 0x000000,
      hemiIntensity: Math.PI,
      sunColor: 0xffffff,
      sunIntensity: Math.PI,
      sunDirection: [0, 1, 0] as const
    }
    expect(lambertOf([1, 1, 1], [0, 1, 0], lights)).toEqual([2, 2, 2])
    const side = lambertOf([1, 0.5, 0], [1, 0, 0], lights)
    expect(side[0]).toBeCloseTo(0.5)
    expect(side[1]).toBeCloseTo(0.25)
  })

  it('lays a member blob shadow along the ground away from the sun', () => {
    const length = Math.hypot(80, 160, 140)
    const blob = shadowBlobOf(100, 16, 12, [80 / length, 160 / length, 140 / length])
    // A 16-tall figure's top lands 8 units left and 14 back; the blob spans feet to that point.
    expect(blob.x).toBeCloseTo(96)
    expect(blob.z).toBeCloseTo(-7)
    expect(blob.length).toBeCloseTo(14)
    expect(blob.width).toBeCloseTo(12 * 0.9)
  })
})
