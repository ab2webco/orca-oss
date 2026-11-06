import { describe, expect, it } from 'vitest'
import { seatPlanOf, TEAM_SCENE_MAX_SEATS } from './team-scene-seats'
import type { TeamSceneMemberInput } from './team-scene-types'

const member = (key: string, activity: TeamSceneMemberInput['activity'] = 'working') =>
  ({ key, name: key, characterKey: null, activity, reportId: null, mergedPr: null }) as const

describe('seatPlanOf', () => {
  it('seats four in one row', () => {
    const plan = seatPlanOf(['a', 'b', 'c', 'd'].map((k) => member(k)))
    expect(plan.overflow).toBe(0)
    expect(new Set(plan.seats.map((s) => s.spot.depth)).size).toBe(1)
    const xs = plan.seats.map((s) => s.spot.x)
    expect([...xs].sort((p, q) => p - q)).toEqual(xs)
  })

  it('opens a second row after four and caps at eight with +N', () => {
    const keys = Array.from({ length: 11 }, (_, i) => `m${i}`)
    const plan = seatPlanOf(keys.map((k) => member(k)))
    expect(plan.seats).toHaveLength(TEAM_SCENE_MAX_SEATS)
    expect(plan.overflow).toBe(3)
    expect(new Set(plan.seats.map((s) => s.spot.depth)).size).toBe(2)
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
