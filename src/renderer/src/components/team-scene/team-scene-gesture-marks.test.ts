import { describe, expect, it } from 'vitest'
import type { TeamSceneGesture } from '../../../../shared/team-scene/team-scene-types'
import { drawSceneGesture } from './team-scene-gesture-marks'
import { recordingContext } from './team-scene-recording-context'

const COLORS = { attention: '#ff0001', done: '#00ff02', working: '#0000f3', risk: '#ffaa04' }
const GESTURES: TeamSceneGesture[] = [
  'lowered',
  'raised',
  'approved',
  'unsure',
  'escalated',
  'ciRunning',
  'ciPassed',
  'ciFailed',
  'stopped',
  'consulting',
  'advised'
]
const drawn = (gesture: TeamSceneGesture) => {
  const r = recordingContext()
  drawSceneGesture(r.g, 50, 40, gesture, COLORS)
  return r
}
// A card is a filled rect, a plate a filled arc: both count as the colour shown.
const colorsOf = (gesture: TeamSceneGesture) =>
  drawn(gesture)
    .calls.filter((c) => c.name === 'fill' || c.name === 'fillRect')
    .map((c) => c.fillStyle)

describe('advisor gesture marks', () => {
  it('draws each gesture as its own mark', () => {
    const shapes = GESTURES.map((g) => JSON.stringify(drawn(g).calls))
    // consulting and advised share the speech dots.
    expect(new Set(shapes).size).toBe(GESTURES.length - 1)
  })

  it('shows a yellow card when unsure, a red one when escalated, in the theme colours', () => {
    expect(colorsOf('unsure')).toContain(COLORS.risk)
    expect(colorsOf('escalated')).toContain(COLORS.attention)
    expect(colorsOf('escalated')).not.toContain(COLORS.risk)
  })

  it('flies a green flag for CI passing and a red one for CI failing', () => {
    expect(colorsOf('ciPassed')).toContain(COLORS.done)
    expect(colorsOf('ciFailed')).toContain(COLORS.attention)
    expect(colorsOf('approved')).toContain(COLORS.done)
  })

  it('stays inside its spot, above the advisor', () => {
    const move = drawn('raised').calls.find((c) => c.name === 'translate')
    expect(move?.args).toEqual([50, 40])
  })
})
