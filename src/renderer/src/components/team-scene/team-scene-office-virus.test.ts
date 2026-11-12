import { describe, expect, it } from 'vitest'
import { drawOfficeVirus, OFFICE_VIRUS_COLORS } from './team-scene-office-virus'
import { recordingContext } from './team-scene-recording-context'

// Orca's Office screen at 420 px: about 25 x 16 stage px.
const RECT = { x: 0, y: 0, width: 25, height: 16 }
const bug = (t: number) => {
  const r = recordingContext()
  drawOfficeVirus(r.g, RECT, t)
  const fill = r.calls.findIndex(
    (c) => c.name === 'fill' && c.fillStyle === OFFICE_VIRUS_COLORS.body
  )
  const body = r.calls.slice(0, fill).findLast((c) => c.name === 'ellipse')!
  return { y: body.args[1] as number, rx: body.args[2] as number }
}

describe('office virus', () => {
  it('is big enough to read at a glance on a 420 px screen', () => {
    expect(bug(0).rx * 2).toBeGreaterThanOrEqual(height(0.6))
  })

  it('makes one big hop every few seconds, well over its small ones', () => {
    const tops = (from: number, to: number) => {
      let top = Infinity
      for (let t = from; t < to; t += 1 / 60) {
        top = Math.min(top, bug(t).y)
      }
      return top
    }
    const small = tops(0, 2.4)
    const big = tops(0, 5)
    expect(big).toBeLessThan(small - RECT.height * 0.2)
  })
})

function height(share: number): number {
  return RECT.height * share
}
