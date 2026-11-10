import { describe, expect, it } from 'vitest'
import type { TeamSceneSiteStage } from '../../../../shared/team-scene/team-scene-sites'
import {
  drawPixelCrates,
  drawPixelPlot,
  drawPixelSack,
  PIXEL_WILT,
  type PixelGardenPalette
} from './team-scene-pixel-garden'
import { recordingContext } from './team-scene-recording-context'

const PALETTE: PixelGardenPalette = { leaf: '#00aa11', fruit: '#ff2200' }
const PX = 3

const plot = (stage: TeamSceneSiteStage, broken = false, t = 0) => {
  const r = recordingContext()
  drawPixelPlot(r.g, 20, 38, PX, { stage, broken }, t, PALETTE)
  return r
}
const rects = (r: ReturnType<typeof recordingContext>, color?: string) =>
  r.calls.filter((c) => c.name === 'fillRect' && (color === undefined || c.fillStyle === color))

describe('pixel garden', () => {
  it('grows from tilled soil to a ripe bed, stage by stage', () => {
    const sizes = ([0, 1, 2, 3, 4] as const).map((stage) => rects(plot(stage)).length)
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!)
    }
    expect(rects(plot(0), PALETTE.leaf)).toHaveLength(0)
  })

  it('bears fruit only once the work is merged', () => {
    for (const stage of [0, 1, 2, 3] as const) {
      expect(rects(plot(stage), PALETTE.fruit)).toHaveLength(0)
    }
    expect(rects(plot(4), PALETTE.fruit).length).toBeGreaterThan(0)
  })

  it('wilts while CI is red: no healthy leaves left', () => {
    const wilted = plot(3, true)
    expect(rects(wilted, PIXEL_WILT).length).toBeGreaterThan(0)
    expect(rects(wilted, PALETTE.leaf)).toHaveLength(0)
  })

  it('lands every block on whole scene pixels', () => {
    for (const call of rects(plot(4, false, 1.3))) {
      for (const n of call.args as number[]) {
        expect(n % PX).toBe(0)
      }
    }
  })

  it('sways the grown plants over time', () => {
    const at = (t: number) => JSON.stringify(rects(plot(3, false, t)).map((c) => c.args))
    expect(at(0)).not.toBe(at(0.7))
  })

  it('draws a seed sack to carry from', () => {
    const r = recordingContext()
    drawPixelSack(r.g, 10, 38, PX)
    expect(rects(r).length).toBeGreaterThanOrEqual(2)
  })

  it('stacks one harvest crate per trophy', () => {
    const one = recordingContext()
    drawPixelCrates(one.g, 1, 38, PX, PALETTE)
    const three = recordingContext()
    drawPixelCrates(three.g, 3, 38, PX, PALETTE)
    expect(rects(three).length).toBe(rects(one).length * 3)
    const none = recordingContext()
    drawPixelCrates(none.g, 0, 38, PX, PALETTE)
    expect(none.calls).toHaveLength(0)
  })
})
