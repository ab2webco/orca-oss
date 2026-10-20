import { describe, expect, it } from 'vitest'

import { daylightAt } from '../hooks/hd-daylight'
import { lightnessOf } from '../hooks/hd-lightness'
import { hdFarPixel, hdFrameOf, hdGroundPixel, hdMidPixel } from '../hooks/scene-hd-land'
import { SCENES, type ScenePhase } from '../hooks/scenes/index'

const PHASES: readonly ScenePhase[] = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
const WIDTH = 120
const ROWS = 10

const layerColors = (
  pixel: (x: number, y: number) => number | undefined,
  pixels: number
): number[] => {
  const colors: number[] = []
  for (let y = 0; y < pixels; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const color = pixel(x, y)
      if (color !== undefined) {
        colors.push(color)
      }
    }
  }
  return colors
}

describe('hd land materials on every built-in scene', () => {
  for (const scene of Object.values(SCENES)) {
    for (const phase of PHASES) {
      const look = scene.looks[phase]
      it(`${scene.id} ${phase}: far, mid and ground layers are textured, not flat`, () => {
        const frame = hdFrameOf({
          look,
          width: WIDTH,
          rows: ROWS,
          tick: 0,
          scroll: 0,
          light: daylightAt(12)
        })
        const far = layerColors((x, y) => hdFarPixel(frame, x, y), frame.ground)
        const mid = layerColors((x, y) => hdMidPixel(frame, x, y), frame.ground)
        const ground: number[] = []
        for (let y = frame.ground + 1; y < frame.pixels; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            ground.push(hdGroundPixel(frame, x, y))
          }
        }
        expect(new Set(far).size).toBeGreaterThanOrEqual(6)
        expect(new Set(mid).size).toBeGreaterThanOrEqual(6)
        expect(new Set(ground).size).toBeGreaterThanOrEqual(6)
      })
    }
  }

  it('lights the far flank that faces the sun brighter than the one turned away', () => {
    const look = SCENES.quest?.looks.working
    if (look === undefined) {
      throw new Error('quest scene missing')
    }
    // Why right of the sun: there the lit flank rises to the right, which a fixed light gets wrong.
    const frame = hdFrameOf({
      look,
      width: WIDTH,
      rows: ROWS,
      tick: 0,
      scroll: 0,
      light: daylightAt(8)
    })
    const toward: number[] = []
    const away: number[] = []
    for (let x = Math.ceil(frame.sunX) + 2; x < WIDTH - 1; x += 1) {
      const left = frame.farTops[x] ?? 0
      const right = frame.farTops[x + 2] ?? 0
      const y = Math.ceil(frame.ground - (frame.farTops[x + 1] ?? 0)) + 1
      const color = hdFarPixel(frame, x, y)
      if (color === undefined || Math.abs(left - right) < 1) {
        continue
      }
      ;(Math.sign(frame.sunX - x) * (left - right) > 0 ? toward : away).push(lightnessOf(color))
    }
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
    expect(toward.length).toBeGreaterThan(5)
    expect(away.length).toBeGreaterThan(5)
    expect(mean(toward)).toBeGreaterThan(mean(away))
  })
})
