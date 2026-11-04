import { describe, expect, it } from 'vitest'

import { NOON } from '../hooks/hd-daylight'
import { lightnessOf } from '../hooks/hd-lightness'
import { hdBackPixel, MARK_TICKS } from '../hooks/scene-hd-depth'
import { hdFarPixel, hdMarkPixel, hdFrameOf, hdMidPixel, hdSkyBaseOf } from '../hooks/scene-hd-land'
import { SCENES } from '../hooks/scenes/index'
import type { Look } from '../hooks/scenes/scene-definition'

// ORCA-968: hd's backdrop has depth, a distant range, a landmark and detail on the hills, in every world.

const WIDTH = 200
const ROWS = 13
const LOOKS = Object.values(SCENES).flatMap((scene) =>
  Object.entries(scene.looks).map(([phase, look]) => ({ label: `${scene.id} ${phase}`, look }))
)

const frameAt = (look: Look, tick = 0) =>
  hdFrameOf({ look, width: WIDTH, rows: ROWS, tick, scroll: 0, light: NOON })

describe('hd depth on every built-in look', () => {
  it('stands a hazy distant range behind the far scenery, nearer the sky than it', () => {
    for (const { label, look } of LOOKS) {
      const frame = frameAt(look)
      let behind = 0
      let hazier = 0
      for (let x = 0; x < WIDTH; x += 1) {
        for (let y = 0; y < frame.ground; y += 1) {
          const back = hdBackPixel(frame, x, y)
          // Why under its ridge: the range's lit edge is meant to stand out from the haze.
          const far = hdFarPixel(frame, x, y + 3)
          const isEdge =
            hdFarPixel(frame, x, y) === undefined && hdFarPixel(frame, x, y + 1) !== undefined
          if (back === undefined || !isEdge || far === undefined) {
            continue
          }
          behind += 1
          const sky = lightnessOf(hdSkyBaseOf(frame, x, y))
          hazier += Math.abs(lightnessOf(back) - sky) < Math.abs(lightnessOf(far) - sky) ? 1 : 0
        }
      }
      expect([label, behind > 20]).toEqual([label, true])
      expect([label, hazier / behind > 0.8]).toEqual([label, true])
    }
  })

  // Why under the top third: the thought clouds take those rows, and hid the landmark there.
  it('stands a landmark on the hills, mostly under the clouds’ rows, in every band width', () => {
    for (const { label, look } of LOOKS) {
      const frame = frameAt(look)
      let shown = 0
      let low = 0
      for (let x = 0; x < WIDTH; x += 1) {
        for (let y = 0; y < frame.ground; y += 1) {
          const isMark = hdMarkPixel(frame, x, y) !== undefined
          shown += isMark ? 1 : 0
          low += isMark && y >= frame.pixels / 3 ? 1 : 0
        }
      }
      expect([label, shown > 30, low / shown > 0.5]).toEqual([label, true, true])
    }
  })

  it('turns the windmill, blinks the beacon and bobs the crystal, and holds the castle still', () => {
    const turns = (look: Look): boolean => {
      const [a, b] = [frameAt(look, 0), frameAt(look, MARK_TICKS)]
      for (let x = 0; x < WIDTH; x += 1) {
        for (let y = 0; y < a.ground; y += 1) {
          if (hdMarkPixel(a, x, y) !== hdMarkPixel(b, x, y)) {
            return true
          }
        }
      }
      return false
    }
    const kinds = new Map(LOOKS.map(({ look }) => [look.scenery ?? 'peaks', turns(look)]))
    expect(Object.fromEntries(kinds)).toEqual({
      peaks: false,
      meadow: true,
      skyline: true,
      crystals: true
    })
  })

  it('stands detail on the hills, and rooftops in the city', () => {
    for (const { label, look } of LOOKS) {
      const frame = frameAt(look)
      let above = 0
      const tops = new Set<number>()
      for (let x = 0; x < WIDTH; x += 1) {
        const top = frame.midTops[x] ?? 0
        tops.add(Math.round(top))
        for (let y = 0; y < top; y += 1) {
          above += hdMidPixel(frame, x, y) === undefined ? 0 : 1
        }
      }
      // Why: a city's near layer is flat roofs, so it shows as few steps rather than as detail.
      const hasDetail = look.scenery === 'skyline' ? tops.size >= 3 : above > 20
      expect([label, hasDetail]).toEqual([label, true])
    }
  })

  // Why: a sunset rim as light as the orange sky behind it vanished, and Quest's dusk read as main's.
  it('rims every rolling range well clear of its sky, at dusk too', () => {
    for (const { label, look } of LOOKS.filter((one) => one.look.scenery === 'meadow')) {
      const frame = frameAt(look)
      let edges = 0
      let clear = 0
      for (let x = 0; x < WIDTH; x += 1) {
        for (let y = 1; y < frame.ground; y += 1) {
          const rim = hdFarPixel(frame, x, y)
          if (rim === undefined || hdFarPixel(frame, x, y - 1) !== undefined) {
            continue
          }
          edges += 1
          const sky = lightnessOf(hdSkyBaseOf(frame, x, y))
          clear += Math.abs(lightnessOf(rim) - sky) >= 14 ? 1 : 0
          break
        }
      }
      expect([label, clear / edges > 0.8]).toEqual([label, true])
    }
  })
})
