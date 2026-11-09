import { describe, expect, it } from 'vitest'
import { FOOT_REACH, QUEST_ACTIONS, WALK_CYCLE_UNITS, footAt, poseAt } from './quest-art-pose.mjs'

describe('the Quest art poses', () => {
  it('slides a planted foot back at one speed, flat on the ground', () => {
    const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((u) => footAt(u))
    expect(steps.every((foot) => foot.y === 0)).toBe(true)
    const deltas = steps.slice(1).map((foot, at) => steps[at].x - foot.x)
    deltas.forEach((delta) => expect(delta).toBeCloseTo(0.4 * FOOT_REACH))
  })

  it('counts as a walk cycle the ground two stances cover', () => {
    expect(WALK_CYCLE_UNITS).toBeCloseTo(2 * (footAt(0).x - footAt(0.5).x))
  })

  it('lifts the foot only on its way forward and closes the cycle', () => {
    expect(footAt(0.75).y).toBeLessThan(0)
    expect(footAt(1).x).toBeCloseTo(footAt(0).x)
    expect(footAt(0.999).x).toBeCloseTo(FOOT_REACH, 1)
  })

  it('keeps one foot planted in every walk frame', () => {
    const { frames } = QUEST_ACTIONS.walk
    for (let frame = 0; frame < frames; frame++) {
      const { legs } = poseAt('walk', frame / frames)
      expect(Math.max(legs.near.y, legs.far.y)).toBeCloseTo(0)
    }
  })

  it('fills every row of the sheet with no action sharing one', () => {
    const rows = Object.values(QUEST_ACTIONS).map((action) => action.row)
    expect([...rows].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('raises the arm for raise, wave and cheer, and seats a worker at a desk', () => {
    for (const action of ['raise', 'wave', 'cheer']) {
      expect(poseAt(action, 0).arm).toBeGreaterThan(2)
    }
    expect(poseAt('work', 0, true).seated).toBe(true)
    expect(poseAt('work', 0).seated).toBe(false)
  })
})
