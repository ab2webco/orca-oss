import { describe, expect, it } from 'vitest'
import { moveTeamSceneBody, teamSceneArrived, type TeamSceneMover } from './team-scene-motion'

const PHONE = 320

const walker = (x: number, to: number): TeamSceneMover => ({
  x,
  depth: 0,
  target: { x: to, depth: 0 },
  v: 0,
  facing: 1,
  gait: 0
})

const walk = (body: TeamSceneMover, width: number): TeamSceneMover => {
  for (let frame = 0; frame < 300; frame++) {
    moveTeamSceneBody(body, 1 / 30, width)
  }
  return body
}

describe('team scene motion', () => {
  it('stops a walker bound near either edge half a figure inside, and counts it arrived', () => {
    // Why 18: Pixel's widest figure is twelve columns of 3 px; a spot 0.04 in is under 13 px on a phone.
    for (const [from, to] of [
      [0.1, 0.04],
      [0.9, 0.97]
    ] as const) {
      const body = walk(walker(from, to), PHONE)
      const px = body.x * PHONE
      expect(Math.min(px, PHONE - px), `${from} to ${to}`).toBeGreaterThanOrEqual(18)
      expect(teamSceneArrived(body, PHONE)).toBe(true)
    }
  })

  it('still walks a figure off the stage when it leaves', () => {
    expect(walk(walker(0.1, -0.1), PHONE).x).toBe(-0.1)
    expect(walk(walker(0.9, 1.04), PHONE).x).toBe(1.04)
  })
})
