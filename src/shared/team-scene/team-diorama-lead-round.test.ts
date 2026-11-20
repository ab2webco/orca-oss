import { describe, expect, it } from 'vitest'
import { DIORAMA_GATE, teamDioramaLayoutOf, type DioramaMachine } from './team-diorama-layout'
import {
  dioramaBoatAt,
  dioramaLeadAt,
  dioramaLeadRoundOf,
  dioramaLeadStepAt,
  dioramaStandOf,
  type DioramaPace
} from './team-diorama-lead-round'
import { dioramaWaterGrid, polyAt } from './team-diorama-nav'
import { dioramaRoadNet } from './team-diorama-roads'

const machine = (key: string, over: Partial<DioramaMachine> = {}): DioramaMachine => ({
  key,
  name: key,
  home: false,
  reachable: true,
  members: [],
  cap: 2,
  taken: 0,
  ...over
})
const layout = teamDioramaLayoutOf([
  machine('', { home: true, members: ['a', 'b'], cap: null }),
  machine('m2', { members: ['x', 'y'] }),
  machine('m3', { members: ['z'], reachable: false })
])
const roads = dioramaRoadNet(layout)
const water = dioramaWaterGrid(layout)
const roundOf = (pace: DioramaPace = 'normal', needs = ['b'], visits = ['a', 'x', 'y', 'z']) =>
  dioramaLeadRoundOf({ layout, roads, water, needs, visits, pace })
const dSeg = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    L2 = dx * dx + dz * dz || 1
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
  return Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dz * u))
}
const offRoad = (p: [number, number]) =>
  Math.min(...layout.roads.flatMap(({ pts }) => pts.slice(1).map((b, k) => dSeg(p, pts[k]!, b))))

describe("the lead's round", () => {
  it('talks first to the member who needs the user', () => {
    const talk = roundOf().steps.find((s) => s.kind === 'hold' && s.pose === 'talk')!
    const b = layout.islands[0]!.plots.find((p) => p.key === 'b')!
    expect(talk.kind === 'hold' && talk.face).toEqual(dioramaStandOf(b))
  })

  it('walks only on the roads, rows only on open water, and ends idle at the gate', () => {
    const { steps } = roundOf()
    for (const step of steps) {
      if (step.kind === 'walk') {
        for (let d = 0; d <= step.cum.at(-1)!; d += 0.1) {
          expect(offRoad(polyAt(step.pts, step.cum, d).at)).toBeLessThan(0.375)
        }
      }
      if (step.kind === 'row') {
        for (let d = 0; d <= step.cum.at(-1)!; d += 0.1) {
          expect(water.free(polyAt(step.pts, step.cum, d).at)).toBe(true)
        }
      }
    }
    const last = steps.at(-1)!
    expect(last.kind === 'hold' && last.pose).toBe('idle')
    expect(
      last.kind === 'hold' && Math.hypot(last.at[0] - DIORAMA_GATE[0], last.at[1] - DIORAMA_GATE[1])
    ).toBeLessThan(0.5)
  })

  it('visits every member of an island in one boat trip, and never an unreachable machine', () => {
    const { steps } = roundOf()
    expect(steps.filter((s) => s.kind === 'row')).toHaveLength(2)
    const talks = steps.filter((s) => s.kind === 'hold' && s.pose === 'talk')
    expect(talks).toHaveLength(4)
  })

  it('sends the lead by magic at the direct pace, and faster at the fast one', () => {
    expect(roundOf('direct').steps.some((s) => s.kind === 'walk' || s.kind === 'row')).toBe(false)
    expect(roundOf('fast').total).toBeLessThan(roundOf('normal').total * 0.6)
  })

  it('loops: a moment past the end is the same step as its remainder', () => {
    const round = roundOf()
    expect(dioramaLeadStepAt(round, round.total + 1)).toBe(dioramaLeadStepAt(round, 1))
  })
})

describe('the lead and the boats at a moment', () => {
  it('seats the lead in its boat while rowing, and moors the boat where the trip left it', () => {
    const round = roundOf()
    const row = round.steps.find((s) => s.kind === 'row')!
    const mid = row.start + row.dur / 2
    const lead = dioramaLeadAt(round, mid)
    expect(lead.pose).toBe('sit')
    const home = layout.homeDocks[lead.column!]!.boat
    const boat = dioramaBoatAt(round, lead.column!, home, mid)
    expect(boat.moving).toBe(true)
    expect(boat.at).toEqual(lead.at)
    // Just after the outbound row, the boat waits at the island while the lead talks.
    const moored = dioramaBoatAt(round, lead.column!, home, row.start + row.dur + 0.5)
    expect(moored.moving).toBe(false)
    expect(Math.hypot(moored.at[0] - home[0], moored.at[1] - home[1])).toBeGreaterThan(1)
    // A whole loop later every boat is home again.
    const back = dioramaBoatAt(round, lead.column!, home, round.total - 0.01).at
    expect(Math.hypot(back[0] - home[0], back[1] - home[1])).toBeLessThan(0.3)
  })

  it('blinks the lead out and in on a direct jump, and walks it otherwise', () => {
    const direct = roundOf('direct')
    const jump = direct.steps.find((s) => s.kind === 'jump')!
    expect(dioramaLeadAt(direct, jump.start + jump.dur / 2).blink).toBeLessThan(0.1)
    const walk = roundOf().steps.find((s) => s.kind === 'walk')!
    expect(dioramaLeadAt(roundOf(), walk.start + walk.dur / 2)).toMatchObject({
      pose: 'walk',
      blink: 1
    })
  })
})
