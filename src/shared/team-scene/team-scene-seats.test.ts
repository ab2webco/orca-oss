import { describe, expect, it } from 'vitest'
import { seatPlanOf, TEAM_SCENE_MAX_SEATS } from './team-scene-seats'
import type { TeamSceneMemberInput } from './team-scene-types'

const member = (key: string, activity: TeamSceneMemberInput['activity'] = 'working') =>
  ({
    key,
    name: key,
    characterKey: null,
    activity,
    reportId: null,
    mergedPr: null,
    site: { stage: 0, broken: false }
  }) as const

describe('seatPlanOf', () => {
  it('seats four in one row', () => {
    const plan = seatPlanOf(['a', 'b', 'c', 'd'].map((k) => member(k)))
    expect(plan.overflow).toBe(0)
    expect(new Set(plan.seats.map((s) => s.spot.depth)).size).toBe(1)
    const xs = plan.seats.map((s) => s.spot.x)
    expect([...xs].sort((p, q) => p - q)).toEqual(xs)
  })

  it('seats up to a row of five in one even row, each at its own x', () => {
    for (const n of [3, 4, 5]) {
      const plan = seatPlanOf(
        Array.from({ length: n }, (_, i) => member(`m${i}`, i === 1 ? 'needsYou' : 'working')),
        5
      )
      expect(new Set(plan.seats.map((s) => s.spot.depth)).size).toBe(1)
      const xs = plan.seats.map((s) => s.spot.x).sort((p, q) => p - q)
      const gaps = xs.slice(1).map((x, i) => x - xs[i]!)
      expect(Math.min(...gaps)).toBeGreaterThan(0.1)
      for (const gap of gaps) {
        expect(gap).toBeCloseTo(gaps[0]!)
      }
    }
  })

  it('opens a second row after four and caps at eight with +N', () => {
    const keys = Array.from({ length: 11 }, (_, i) => `m${i}`)
    const plan = seatPlanOf(keys.map((k) => member(k)))
    expect(plan.seats).toHaveLength(TEAM_SCENE_MAX_SEATS)
    expect(plan.overflow).toBe(3)
    expect(new Set(plan.seats.map((s) => s.spot.depth)).size).toBe(2)
  })

  it('staggers the front row so no one stands right in front of a back-row seat', () => {
    const plan = seatPlanOf(Array.from({ length: 8 }, (_, i) => member(`m${i}`)))
    const back = plan.seats.slice(0, 4).map((s) => s.spot.x)
    const front = plan.seats.slice(4).map((s) => s.spot.x)
    for (const x of front) {
      expect(Math.min(...back.map((b) => Math.abs(b - x)))).toBeGreaterThan(0.05)
    }
  })

  it('seats members who need the user first, so overflow never hides them', () => {
    const list = Array.from({ length: 9 }, (_, i) => member(`m${i}`))
    list[8] = member('asker', 'needsYou')
    const plan = seatPlanOf(list)
    expect(plan.seats[0].key).toBe('asker')
    expect(plan.seats.map((s) => s.key)).not.toContain('m7')
  })

  it('keeps the input order otherwise', () => {
    const plan = seatPlanOf([member('b'), member('a', 'resting')])
    expect(plan.seats.map((s) => s.key)).toEqual(['b', 'a'])
  })
})
