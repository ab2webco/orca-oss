import { describe, expect, it } from 'vitest'
import { daylightAt } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { STATE_RING } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-party'
import {
  costumeSpriteOf,
  hdSpritePixel
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-sprite'
import { hdFrameOf } from '../../../../../resources/claude-plugins/orca-game/hooks/scene-hd-land'
import { QUEST_SCENE } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/quest'
import { castOf, hd2dWorldOf, spriteImageOf, WORLD_ROWS } from './hd2d-world'

const rgbaAt = (image: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => {
  const i = (y * image.width + x) * 4
  return [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2], image.rgba[i + 3]]
}

describe('hd2d world', () => {
  it('takes its silhouettes from the scene own hd land', () => {
    const world = hd2dWorldOf(QUEST_SCENE, 120, daylightAt(12))
    const frame = hdFrameOf({
      look: QUEST_SCENE.looks.working,
      width: 120,
      rows: WORLD_ROWS,
      tick: 0,
      scroll: 0,
      light: daylightAt(12)
    })
    expect(world.far.heights[30]).toBeCloseTo(frame.farTops[31] ?? -1)
    expect(world.mid.heights[30]).toBeCloseTo(frame.ground - (frame.midTops[30] ?? 0))
    expect(world.ground).toBe(frame.ground)
    expect(world.far.heights.length).toBe(120)
  })

  it('colors the sky from the look, darker at night', () => {
    const noon = hd2dWorldOf(QUEST_SCENE, 80, daylightAt(12))
    const night = hd2dWorldOf(QUEST_SCENE, 80, daylightAt(0))
    const luma = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
    expect(noon.sky.length).toBe(noon.ground)
    expect(luma(night.sky[0] ?? 0)).toBeLessThan(luma(noon.sky[0] ?? 0))
    expect(night.night).toBe(1)
    expect(noon.sun.x).toBeGreaterThan(0)
  })
})

describe('plants', () => {
  it('draws one plant from the land art and plants it where the land does', () => {
    const world = hd2dWorldOf(QUEST_SCENE, 400, daylightAt(12))
    expect(world.plants).not.toBeNull()
    const solid = Array.from(world.plants?.image.rgba ?? []).filter((_, i) => i % 4 === 3 && _ > 0)
    expect(solid.length).toBeGreaterThan(10)
    expect(world.plants?.lefts.length).toBeGreaterThan(3)
    expect(world.plants?.lefts.length).toBeLessThan(400 / 19)
  })
})

describe('sprite image', () => {
  it('copies every hd sprite pixel, transparent where the sprite has none', () => {
    const sprite = costumeSpriteOf(QUEST_SCENE.costumes.working, 0, false)
    const image = spriteImageOf(sprite, STATE_RING.working)
    expect(image.width).toBe(sprite.width)
    expect(image.height).toBe(sprite.rows.length)
    let solid = 0
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const color = hdSpritePixel(sprite, x, y, 0, 0, STATE_RING.working)
        const [r, g, b, a] = rgbaAt(image, x, y)
        if (color === undefined) {
          expect(a).toBe(0)
        } else {
          solid += 1
          expect([r, g, b, a]).toEqual([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255])
        }
      }
    }
    expect(solid).toBeGreaterThan(40)
  })
})

describe('cast', () => {
  it('dresses each member in one of the scene costumes, the lead in the working one', () => {
    const cast = castOf(QUEST_SCENE, [
      { key: 'lead', isLead: true },
      { key: 'a', isLead: false },
      { key: 'b', isLead: false }
    ])
    expect(cast.get('lead')).toBe('working')
    const phases = Object.keys(QUEST_SCENE.costumes)
    expect(phases).toContain(cast.get('a'))
    expect(cast.get('a')).not.toBe(cast.get('b'))
  })
})
