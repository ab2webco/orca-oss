import { describe, expect, it } from 'vitest'

import { NOON } from '../hooks/hd-daylight'
import { lightnessOf } from '../hooks/hd-lightness'
import { hdBackPixel, MARK_TICKS } from '../hooks/scene-hd-depth'
import {
  hdFarMarkPixel,
  hdFarPixel,
  hdFrameOf,
  hdMidPixel,
  hdSkyBaseOf
} from '../hooks/scene-hd-land'
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
          const far = hdFarPixel(frame, x, y + 1)
          if (back === undefined || hdFarPixel(frame, x, y) !== undefined || far === undefined) {
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

  it('puts a landmark on the far range in every band width', () => {
    for (const { label, look } of LOOKS) {
      const frame = frameAt(look)
      let shown = 0
      for (let x = 0; x < WIDTH; x += 1) {
        for (let y = 0; y < frame.ground; y += 1) {
          shown += hdFarMarkPixel(frame, x, y) === undefined ? 0 : 1
        }
      }
      expect([label, shown > 30]).toEqual([label, true])
    }
  })

  it('turns the windmill, blinks the beacon and bobs the crystal, and holds the castle still', () => {
    const turns = (look: Look): boolean => {
      const [a, b] = [frameAt(look, 0), frameAt(look, MARK_TICKS)]
      for (let x = 0; x < WIDTH; x += 1) {
        for (let y = 0; y < a.ground; y += 1) {
          if (hdFarMarkPixel(a, x, y) !== hdFarMarkPixel(b, x, y)) {
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
})
