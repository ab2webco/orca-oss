import { describe, expect, it } from 'vitest'
import {
  DIORAMA_GATE,
  DIORAMA_LANE_Z,
  teamDioramaLayoutOf,
  type DioramaMachine
} from './team-diorama-layout'
import { polyAt, polyLengths } from './team-diorama-nav'
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
const layout = teamDioramaLayoutOf([machine('', { home: true }), machine('m2'), machine('m3')])
const dSeg = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    L2 = dx * dx + dz * dz || 1
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
  return Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dz * u))
}
const offRoad = (p: [number, number]) =>
  Math.min(...layout.roads.flatMap(({ pts }) => pts.slice(1).map((b, k) => dSeg(p, pts[k]!, b))))

describe('the road net', () => {
  it('keeps the lead on the roads, inside their 0.75 width, from the gate to every home dock', () => {
    const net = dioramaRoadNet(layout)
    for (const dock of Object.values(layout.homeDocks)) {
      const pts = net.route(DIORAMA_GATE, dock.end)
      const cum = polyLengths(pts)
      expect(Math.hypot(pts.at(-1)![0] - dock.end[0], pts.at(-1)![1] - dock.end[1])).toBeLessThan(
        0.3
      )
      for (let d = 0; d <= cum.at(-1)!; d += 0.1) {
        expect(offRoad(polyAt(pts, cum, d).at)).toBeLessThan(0.375)
      }
    }
  })

  it('never routes across the water: each island is its own part, joined only by boat', () => {
    const net = dioramaRoadNet(layout)
    const island = layout.islands.find((i) => i.key === 'm2')!
    expect(net.islandOf(DIORAMA_GATE)).not.toBe(net.islandOf(island.dock!.end))
    expect(net.route(DIORAMA_GATE, island.dock!.end)).toHaveLength(1)
    expect(net.islandOf([0, DIORAMA_LANE_Z])).toBe(net.islandOf(DIORAMA_GATE))
  })
})
