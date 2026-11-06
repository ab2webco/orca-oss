import { describe, expect, it } from 'vitest'
import {
  teamSceneScaleAt,
  teamSceneStrideAt
} from '../../../../shared/team-scene/team-scene-motion'
import { drawOfficeFigure, OFFICE_FIGURE_SCALE, officeLookOf } from './team-scene-office-figure'
import { recordingContext } from './team-scene-recording-context'

const pose = { t: 0, pose: 'idle' as const, gait: 0, carrying: false, seated: false }

describe('drawOfficeFigure', () => {
  it('keeps the taller office stride equal to the simulation stride', () => {
    const feet = (gait: number) => {
      const rec = recordingContext()
      drawOfficeFigure(rec.g, officeLookOf({ role: 'member', key: 'a', characterKey: null }), {
        ...pose,
        pose: 'walk',
        gait
      })
      return rec.calls.filter((c) => c.name === 'roundRect').map((c) => c.args[0] as number)
    }
    const stance = (feet(0)[0]! - feet(Math.PI - 1e-9)[0]!) * OFFICE_FIGURE_SCALE
    const d = 0.5
    expect(stance).toBeCloseTo(teamSceneStrideAt(d) / teamSceneScaleAt(d), 4)
  })

  it('sits with still legs at a desk and crowns only the lead', () => {
    const member = recordingContext()
    drawOfficeFigure(member.g, officeLookOf({ role: 'member', key: 'a', characterKey: null }), {
      ...pose,
      pose: 'work',
      seated: true
    })
    const lead = recordingContext()
    drawOfficeFigure(lead.g, officeLookOf({ role: 'lead', key: 'lead', characterKey: null }), pose)
    expect(lead.fills()).toContain('#f2c94c')
    expect(member.fills()).not.toContain('#f2c94c')
  })

  it('gives a member one hair colour wherever it runs', () => {
    expect(officeLookOf({ role: 'member', key: 'p1', characterKey: 'arthur' })).toEqual(
      officeLookOf({ role: 'member', key: 'p2', characterKey: 'arthur' })
    )
  })
})
