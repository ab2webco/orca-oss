import { describe, expect, it } from 'vitest'
import type { TeamSceneSiteStage } from '../../../../shared/team-scene/team-scene-sites'
import {
  CASTLE_BANNER,
  CASTLE_RUBBLE,
  drawCastlePile,
  drawCastleSite,
  drawCastleTrophies
} from './team-scene-castle-sites'
import { recordingContext } from './team-scene-recording-context'

const blocksAt = (stage: TeamSceneSiteStage, broken = false) => {
  const r = recordingContext()
  drawCastleSite(r.g, 100, 150, 1, { stage, broken }, 0)
  return r
}
const count = (r: ReturnType<typeof recordingContext>, name: string) =>
  r.calls.filter((c) => c.name === name).length

describe('castle sites', () => {
  it('grows with every stage, from the foundation to the finished tower', () => {
    const sizes = ([0, 1, 2, 3, 4] as const).map((stage) => count(blocksAt(stage), 'fillRect'))
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!)
    }
  })

  it('flies the banner only once the work is merged', () => {
    for (const stage of [0, 1, 2, 3] as const) {
      expect(blocksAt(stage).fills()).not.toContain(CASTLE_BANNER)
    }
    expect(blocksAt(4).fills()).toContain(CASTLE_BANNER)
  })

  it('shows fallen stones while CI is red', () => {
    const whole = blocksAt(3)
    const broken = blocksAt(3, true)
    const rubble = (r: ReturnType<typeof recordingContext>) =>
      r.calls.some((c) => c.name === 'fillRect' && c.fillStyle === CASTLE_RUBBLE)
    expect(rubble(whole)).toBe(false)
    expect(rubble(broken)).toBe(true)
  })

  it('waves the banner over time', () => {
    const at = (t: number) => {
      const r = recordingContext()
      drawCastleSite(r.g, 100, 150, 1, { stage: 4, broken: false }, t)
      return JSON.stringify(r.calls.filter((c) => c.name === 'lineTo').map((c) => c.args))
    }
    expect(at(0)).not.toBe(at(0.4))
  })

  it('draws a pile of stones to carry from', () => {
    const r = recordingContext()
    drawCastlePile(r.g, 60, 150, 1)
    expect(count(r, 'fillRect')).toBeGreaterThanOrEqual(3)
  })

  it('keeps one finished tower per trophy, each with its banner', () => {
    const r = recordingContext()
    drawCastleTrophies(r.g, 2, 360, 110, 0)
    expect(r.fills().filter((f) => f === CASTLE_BANNER)).toHaveLength(2)
    const none = recordingContext()
    drawCastleTrophies(none.g, 0, 360, 110, 0)
    expect(none.calls).toHaveLength(0)
  })
})
