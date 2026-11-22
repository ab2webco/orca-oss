import { describe, expect, it } from 'vitest'
import { DIORAMA_GATE, teamDioramaLayoutOf, type DioramaMachine } from './team-diorama-layout'
import {
  dioramaBoatAt,
  dioramaLeadAt,
  dioramaLeadJumpAt,
  dioramaLeadRoundOf,
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
  machine('m2', { members: ['x', 'y'] })
])
const roads = dioramaRoadNet(layout)
const water = dioramaWaterGrid(layout)
const tripOf = (
  from: string | null,
  to: string | null,
  start = 10,
  pace: DioramaPace = 'normal',
  stands?: ReadonlyMap<string, [number, number]>
) => dioramaLeadRoundOf({ layout, roads, water, pace, stands, trip: { from, to, start } })
const plotOf = (key: string) => layout.islands.flatMap((i) => i.plots).find((p) => p.key === key)!
const far = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const dSeg = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    L2 = dx * dx + dz * dz || 1
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
  return Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dz * u))
}
const offRoad = (p: [number, number]) =>
  Math.min(...layout.roads.flatMap(({ pts }) => pts.slice(1).map((b, k) => dSeg(p, pts[k]!, b))))
const arrivalOf = (round: ReturnType<typeof tripOf>) => round.steps.at(-1)!.start

// ORCA-1336: the lead leaves the castle only for a real event, as the 3D Office lead does.
describe("the lead's trip", () => {
  it('with nobody asking, stays idle at the gate at every moment', () => {
    const round = tripOf(null, null)
    for (const t of [0, 3, 10, 60, 600, 1e5]) {
      const at = dioramaLeadAt(round, t)
      expect(at.pose).toBe('idle')
      expect(far(at.at, DIORAMA_GATE)).toBeLessThan(0.5)
    }
  })

  it('sets out when the member starts asking and stays talking to it until answered', () => {
    const round = tripOf(null, 'b', 10)
    expect(far(dioramaLeadAt(round, 5).at, DIORAMA_GATE)).toBeLessThan(0.5)
    expect(dioramaLeadAt(round, 10.5).pose).toBe('walk')
    for (const t of [arrivalOf(round) + 1, 600, 1e5]) {
      const at = dioramaLeadAt(round, t)
      expect(at.pose).toBe('talk')
      // A step away on the road, facing the member, never inside it.
      expect(far(at.at, dioramaStandOf(plotOf('b')))).toBeGreaterThan(1.29)
    }
  })

  it('talks to the member where its state stands it', () => {
    const stand: [number, number] = [plotOf('b').x + 1.6, plotOf('b').z + 1.25]
    const last = tripOf(null, 'b', 0, 'normal', new Map([['b', stand]])).steps.at(-1)!
    expect(last.kind === 'hold' && last.face).toEqual(stand)
  })

  it('walks only on the roads and rows only on open water, one row per crossing', () => {
    for (const [from, to, rows] of [
      [null, 'x', 1],
      ['x', 'a', 1],
      ['x', 'y', 0],
      ['a', 'b', 0],
      ['y', null, 1]
    ] as const) {
      const { steps } = tripOf(from, to)
      expect(
        steps.filter((s) => s.kind === 'row' && s.dur > 0),
        `${from} to ${to}`
      ).toHaveLength(rows)
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
    }
  })

  it('walks home to the gate and idles there once nobody asks', () => {
    const round = tripOf('b', null, 10)
    expect(dioramaLeadAt(round, 9).pose).toBe('talk')
    const end = dioramaLeadAt(round, 1e5)
    expect(end.pose).toBe('idle')
    expect(far(end.at, DIORAMA_GATE)).toBeLessThan(0.5)
  })

  it('goes by magic at the direct pace, and arrives sooner at the fast one', () => {
    const direct = tripOf(null, 'x', 0, 'direct')
    expect(direct.steps.some((s) => s.kind === 'walk' || s.kind === 'row')).toBe(false)
    const jump = direct.steps.find((s) => s.kind === 'jump')!
    expect(dioramaLeadAt(direct, jump.start + jump.dur / 2).blink).toBeLessThan(0.1)
    expect(dioramaLeadJumpAt(direct, jump.start + jump.dur / 2)?.k).toBeCloseTo(0.5, 5)
    expect(dioramaLeadJumpAt(tripOf(null, 'x', 0), 1)).toBeNull()
    expect(arrivalOf(tripOf(null, 'x', 0, 'fast'))).toBeLessThan(
      arrivalOf(tripOf(null, 'x', 0)) * 0.6
    )
  })
})

describe('the boats on a trip', () => {
  it('seats the lead while it rows, and leaves the boat at the island while it stays', () => {
    const round = tripOf(null, 'x', 0)
    const row = round.steps.find((s) => s.kind === 'row' && s.dur > 0)!
    const mid = row.start + row.dur / 2
    const lead = dioramaLeadAt(round, mid)
    expect(lead.pose).toBe('sit')
    const home = layout.homeDocks[lead.column!]!.boat
    const boat = dioramaBoatAt(round, lead.column!, home, mid)
    expect(boat.moving).toBe(true)
    expect(boat.at).toEqual(lead.at)
    const moored = dioramaBoatAt(round, lead.column!, home, 1e5)
    expect(moored.moving).toBe(false)
    expect(far(moored.at, home)).toBeGreaterThan(1)
  })

  it('finds the boat at the island the lead stayed on, and rows it home on the way back', () => {
    const round = tripOf('x', 'a', 10)
    const column = layout.islands.find((i) => !i.home)!.column
    const home = layout.homeDocks[column]!.boat
    expect(far(dioramaBoatAt(round, column, home, 5).at, home)).toBeGreaterThan(1)
    expect(far(dioramaBoatAt(round, column, home, 1e5).at, home)).toBeLessThan(0.3)
  })
})
