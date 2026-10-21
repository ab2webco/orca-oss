import { beforeEach, describe, expect, it, vi } from 'vitest'

import { daylightAt, landInLight } from '../hooks/hd-daylight'
import { hdBakedGroundOf, hdBakedLandOf, hdLandBakeOf } from '../hooks/hd-land-bake'
import * as material from '../hooks/hd-material'
import { hdSceneGridOf } from '../hooks/scene-hd'
import { hdFarPixel, hdFrameOf, hdGroundPixel, hdMidPixel } from '../hooks/scene-hd-land'
import { SCENES } from '../hooks/scenes/index'

vi.mock('../hooks/hd-material', async (original) => {
  const real = await original<typeof material>()
  return { ...real, materialPixel: vi.fn(real.materialPixel) }
})

const QUEST = SCENES.quest
if (QUEST === undefined) {
  throw new Error('quest scene missing')
}
const WIDTH = 90
const ROWS = 14
const NOON = daylightAt(12)

const frameAt = (scroll: number, look = QUEST.looks.working, light = NOON) =>
  hdFrameOf({ look, width: WIDTH, rows: ROWS, tick: scroll, scroll, light })

const gridAt = (tick: number, isResting: boolean) =>
  hdSceneGridOf({
    scene: QUEST,
    phase: 'working',
    columns: WIDTH,
    rows: ROWS,
    tick,
    caption: '',
    since: 0,
    isResting,
    light: NOON
  })

const calls = (): number => vi.mocked(material.materialPixel).mock.calls.length

describe('baked hd land', () => {
  beforeEach(() => {
    vi.mocked(material.materialPixel).mockClear()
  })

  it('draws the same far range, hills and lit ground as the per-pixel layers', () => {
    for (const scene of Object.values(SCENES)) {
      for (const look of Object.values(scene.looks)) {
        // Why several scrolls: the sun's column flips the facing as the layers pass under it.
        for (const scroll of [0, 1, 5, 6, 37, 240]) {
          for (const light of [NOON, daylightAt(22), daylightAt(18.5)]) {
            const frame = frameAt(scroll, look, light)
            const bake = hdLandBakeOf(frame)
            for (let y = 0; y < frame.pixels; y += 1) {
              for (let x = 0; x < WIDTH; x += 1) {
                const want =
                  y >= frame.ground
                    ? landInLight(
                        hdGroundPixel(frame, x, y),
                        frame.light,
                        frame.dayLift,
                        look.isNight
                      )
                    : (hdMidPixel(frame, x, y) ?? hdFarPixel(frame, x, y))
                const got =
                  y >= frame.ground
                    ? hdBakedGroundOf(bake, frame, x, y)
                    : hdBakedLandOf(bake, frame, x, y)
                expect(got).toBe(want)
              }
            }
          }
        }
      }
    }
  })

  it('computes no land material on a second frame at rest', () => {
    gridAt(400, true)
    const first = calls()
    gridAt(401, true)
    expect(first).toBeGreaterThan(0)
    expect(calls() - first).toBe(0)
  })

  it('a walking step computes only the columns it brings in', () => {
    gridAt(600, false)
    const first = calls()
    gridAt(601, false)
    // One new ground column, and at most one new hill and far column, each `pixels` tall.
    expect(calls() - first).toBeLessThanOrEqual(ROWS * 2 * 3)
  })
})
