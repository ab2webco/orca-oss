import { beforeEach, describe, expect, it, vi } from 'vitest'

import { daylightAt, landInLight } from '../hooks/hd-daylight'
import { hdBakedGroundOf, hdBakedLandOf, hdLandBakeOf } from '../hooks/hd-land-bake'
import * as material from '../hooks/hd-material'
import { hdSceneGridOf } from '../hooks/scene-hd'
import { hdFarPixel, hdFrameOf, hdGroundPixel, hdMidPixel } from '../hooks/scene-hd-land'
import { hdBackPixel } from '../hooks/scene-hd-depth'
import { SCENES } from '../hooks/scenes/index'

vi.mock('../hooks/hd-material', async (original) => {
  const real = await original<typeof material>()
  return { ...real, backdropMaterialPixel: vi.fn(real.backdropMaterialPixel) }
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

const calls = (): number => vi.mocked(material.backdropMaterialPixel).mock.calls.length

describe('baked hd land', () => {
  beforeEach(() => {
    vi.mocked(material.backdropMaterialPixel).mockClear()
  })

  // Why one `it` per scene and one assertion per frame: an `expect` per pixel was ~80% of the
  // cost and pushed the whole sweep past 30 s on the Windows runner.
  it.each(Object.keys(SCENES))(
    'draws %s like the per-pixel far range, hills and lit ground',
    (id) => {
      const diverged: string[] = []
      for (const [phase, look] of Object.entries(SCENES[id]?.looks ?? {})) {
        // Why several scrolls: the sun's column flips the facing as the layers pass under it.
        for (const scroll of [0, 1, 5, 6, 37, 240]) {
          for (const [hour, light] of [12, 22, 18.5].map((h) => [h, daylightAt(h)] as const)) {
            const frame = frameAt(scroll, look, light)
            const bake = hdLandBakeOf(frame)
            let first: string | undefined
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
                    : (hdMidPixel(frame, x, y) ??
                      hdFarPixel(frame, x, y) ??
                      hdBackPixel(frame, x, y))
                const got =
                  y >= frame.ground
                    ? hdBakedGroundOf(bake, frame, x, y)
                    : hdBakedLandOf(bake, frame, x, y)
                if (first === undefined && !Object.is(got, want)) {
                  first = `${phase} scroll ${scroll} hour ${hour} at (${x}, ${y}): ${got} != ${want}`
                }
              }
            }
            if (first !== undefined) {
              diverged.push(first)
            }
          }
        }
      }
      expect(diverged).toEqual([])
    }
  )

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
