import { describe, expect, it } from 'vitest'
import { DIORAMA_KEEP, teamDioramaLayoutOf, type DioramaMachine } from './team-diorama-layout'
import { dioramaWalkGrid, dioramaWaterGrid, polyAt, polyLengths } from './team-diorama-nav'

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
  machine('', { home: true, members: ['a', 'b', 'c', 'd', 'e', 'f'], cap: null }),
  machine('m2', { members: ['x'] }),
  machine('m3'),
  machine('m4'),
  machine('m5', { cap: 3 })
])
// Samples a polyline every 0.1 so a cut across a corner cannot hide between its points.
const along = (pts: [number, number][]): [number, number][] => {
  const cum = polyLengths(pts)
  const out: [number, number][] = []
  for (let d = 0; d <= cum.at(-1)!; d += 0.1) {
    out.push(polyAt(pts, cum, d).at)
  }
  return out
}

describe('the walk grid', () => {
  it('walks round the keep and every plot, never through them, and stays on land', () => {
    const grid = dioramaWalkGrid(layout)
    const path = grid.path([-9, -4.5], [9, 1.5])
    expect(path.length).toBeGreaterThan(2)
    for (const [x, z] of along(path)) {
      expect(Math.abs(x - DIORAMA_KEEP[0]) > 1.75 || Math.abs(z - DIORAMA_KEEP[1]) > 1.75).toBe(
        true
      )
      for (const plot of layout.islands[0]!.plots) {
        expect(Math.abs(x - plot.x) > 1 || Math.abs(z - plot.z) > 1).toBe(true)
      }
      const home = layout.islands[0]!.rect
      expect(Math.abs(x - home.x) < home.hw && Math.abs(z - home.z) < home.hd).toBe(true)
    }
  })
})

describe('the water grid', () => {
  it('rows from a home dock to an island in the second row round the islands between', () => {
    const water = dioramaWaterGrid(layout)
    const target = layout.islands.find((i) => i.key === 'm5')!
    const path = water.path(layout.homeDocks[0]!.boat, target.dock!.boat)
    expect(
      Math.hypot(path.at(-1)![0] - target.dock!.boat[0], path.at(-1)![1] - target.dock!.boat[1])
    ).toBeLessThan(0.5)
    for (const [x, z] of along(path)) {
      for (const { rect: r } of layout.islands) {
        expect(Math.abs(x - r.x) > r.hw + 0.5 || Math.abs(z - r.z) > r.hd + 0.5).toBe(true)
      }
    }
  })
})

describe('polyAt', () => {
  it('walks a polyline at a steady distance and gives the heading', () => {
    const pts: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2]
    ]
    const cum = polyLengths(pts)
    expect(cum).toEqual([0, 2, 4])
    expect(polyAt(pts, cum, 3)).toEqual({ at: [2, 1], heading: [0, 2] })
  })
})
