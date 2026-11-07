import { describe, expect, it } from 'vitest'
import {
  teamSceneScaleAt,
  teamSceneStrideAt
} from '../../../../shared/team-scene/team-scene-motion'
import { drawFigure, FIGURE_FOOT_REACH, footOffsetOf } from './team-scene-figure-draw'
import { figureLookOf } from './team-scene-figure-looks'
import { recordingContext } from './team-scene-recording-context'

describe('footOffsetOf', () => {
  it('keeps the foot on the ground for the whole stance', () => {
    for (let u = 0; u < Math.PI; u += 0.1) {
      expect(footOffsetOf(u).y).toBe(0)
    }
    expect(footOffsetOf(Math.PI * 1.5).y).toBeLessThan(0)
  })

  it('slides the planted foot back exactly one stride, matching the walk speed', () => {
    const travel = footOffsetOf(0).x - footOffsetOf(Math.PI - 1e-9).x
    expect(travel).toBeCloseTo(2 * FIGURE_FOOT_REACH, 5)
    expect(2 * FIGURE_FOOT_REACH).toBeCloseTo(teamSceneStrideAt(0.5) / teamSceneScaleAt(0.5), 5)
  })
})

describe('drawFigure', () => {
  const lead = figureLookOf({ role: 'lead', key: 'lead', characterKey: null })

  it('draws a crown only for the lead', () => {
    const crowned = recordingContext()
    drawFigure(crowned.g, lead, { t: 0, pose: 'idle', gait: 0, carrying: false })
    const plain = recordingContext()
    drawFigure(plain.g, { ...lead, hat: 'helm' }, { t: 0, pose: 'idle', gait: 0, carrying: false })
    expect(crowned.fills()).toContain(lead.trim)
    expect(plain.fills()).not.toContain(lead.trim)
  })

  it('steps the feet with the gait while walking and plants them while standing', () => {
    const at = (pose: 'walk' | 'idle', gait: number) => {
      const r = recordingContext()
      drawFigure(r.g, lead, { t: 0, pose, gait, carrying: false })
      // The first two ellipses are the feet; their x is where each one stands.
      return JSON.stringify(
        r.calls
          .filter((c) => c.name === 'ellipse')
          .slice(0, 2)
          .map((c) => c.args[0])
      )
    }
    expect(at('walk', 0)).not.toBe(at('walk', 1.5))
    expect(at('idle', 0)).toBe(at('idle', 1.5))
  })

  it('draws the carried report', () => {
    const carrying = recordingContext()
    drawFigure(carrying.g, lead, { t: 0, pose: 'walk', gait: 0, carrying: true })
    expect(carrying.fills()).toContain('#f4e6c0')
  })
})
