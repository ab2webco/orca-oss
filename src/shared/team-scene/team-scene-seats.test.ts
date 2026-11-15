import { describe, expect, it } from 'vitest'
import { seatPlanOf, TEAM_SCENE_MAX_SEATS, teamSceneSeatOrderOf } from './team-scene-seats'
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

  it('starts a row where the style asks, keeping its spacing', () => {
    const members = Array.from({ length: 5 }, (_, i) => member(`m${i}`))
    const plain = seatPlanOf(members, 5).seats.map((s) => s.spot.x)
    const shifted = seatPlanOf(members, 5, 0.16).seats.map((s) => s.spot.x)
    expect(shifted[0]).toBeCloseTo(0.16)
    shifted.forEach((x, i) => expect(x - plain[i]!).toBeCloseTo(0.06))
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

  it('closes up one row past its size when the style asks, never opening a second', () => {
    const six = Array.from({ length: 6 }, (_, i) => member(`m${i}`))
    const plan = seatPlanOf(six, 5, 0.16, undefined, [], true)
    expect(new Set(plan.seats.map((s) => s.spot.depth)).size).toBe(1)
    const xs = plan.seats.map((s) => s.spot.x)
    expect(xs[0]).toBeCloseTo(0.16)
    expect(xs.at(-1)).toBeCloseTo(seatPlanOf(six.slice(0, 5), 5, 0.16).seats.at(-1)!.spot.x)
    expect(new Set(xs).size).toBe(6)
  })
})

// ORCA-1204: the Team model sorts members by status, so a seat by list index moved every desk
// when one member's state changed.
describe('teamSceneSeatOrderOf', () => {
  const keys = (plan: { seats: { key: string }[] }) => plan.seats.map((s) => s.key)

  it('keeps every seat when the list is reordered by a state change', () => {
    const first = seatPlanOf([member('a'), member('b', 'resting'), member('c', 'done')], 5)
    const resorted = seatPlanOf(
      [member('b'), member('a'), member('c', 'done')],
      5,
      undefined,
      undefined,
      first.order
    )
    expect(resorted.seats).toEqual(first.seats)
  })

  it('keeps a member asking the user at its own desk instead of moving it first', () => {
    const first = seatPlanOf([member('a'), member('b'), member('c')], 5)
    const asks = seatPlanOf(
      [member('c', 'needsYou'), member('a'), member('b')],
      5,
      undefined,
      undefined,
      first.order
    )
    expect(keys(asks)).toEqual(['a', 'b', 'c'])
    expect(asks.seats).toEqual(first.seats)
  })

  it('leaves a gone member its desk, empty, and gives it to the next newcomer', () => {
    const first = seatPlanOf([member('a'), member('b'), member('c')], 5)
    const gone = seatPlanOf([member('a'), member('c')], 5, undefined, undefined, first.order)
    expect(gone.seats).toEqual([first.seats[0], first.seats[2]])
    expect(gone.empty).toEqual([first.seats[1]!.spot])
    const joined = seatPlanOf(
      [member('a'), member('c'), member('d')],
      5,
      undefined,
      undefined,
      gone.order
    )
    expect(joined.seats.find((s) => s.key === 'd')!.spot).toEqual(first.seats[1]!.spot)
    expect(joined.empty).toEqual([])
  })

  it('lets a newcomer who needs the user past a full stage take a seat from one who does not', () => {
    const full = Array.from({ length: TEAM_SCENE_MAX_SEATS }, (_, i) => `m${i}`)
    const order = teamSceneSeatOrderOf(
      [...full.map((k) => member(k)), member('asker', 'needsYou')],
      full
    )
    expect(order).toContain('asker')
    expect(order.filter((k) => k !== null)).toHaveLength(TEAM_SCENE_MAX_SEATS)
    expect(order.slice(0, -1)).toEqual(full.slice(0, -1))
  })
})
