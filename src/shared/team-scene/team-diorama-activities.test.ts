import { describe, expect, it } from 'vitest'
import { dioramaPlotViewOf } from './team-diorama-actions'
import { DIORAMA_FIRE, dioramaActivitySpotsOf } from './team-diorama-activities'
import { teamDioramaLayoutOf, type DioramaMachine } from './team-diorama-layout'
import type { TeamSceneMemberInput } from './team-scene-types'

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
const member = (key: string, over: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'resting',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false },
  ...over
})

describe('where free and resting members go', () => {
  it('sends free members to fish, farm and chop, and resting ones round the fire', () => {
    const layout = teamDioramaLayoutOf([
      machine('', { home: true, members: ['f', 'g', 'c', 'r'], cap: null })
    ])
    const views = new Map([
      ['f', dioramaPlotViewOf(member('f'), 0)],
      ['g', dioramaPlotViewOf(member('g'), 1)],
      ['c', dioramaPlotViewOf(member('c'), 2)],
      ['r', dioramaPlotViewOf(member('r', { activity: 'blocked', hold: 'limited' }))]
    ])
    const spots = dioramaActivitySpotsOf(layout, views)
    expect(spots.map((s) => [s.key, s.kind])).toEqual([
      ['f', 'fish'],
      ['g', 'farm'],
      ['c', 'chop'],
      ['r', 'rest']
    ])
    const rest = spots.find((s) => s.kind === 'rest')!
    expect(Math.hypot(rest.at[0] - DIORAMA_FIRE[0], rest.at[1] - DIORAMA_FIRE[1])).toBeCloseTo(1, 5)
    expect(spots.find((s) => s.kind === 'farm')!.loop!.length).toBe(4)
  })

  it('has a free member on another machine fish off its own island, one per island', () => {
    const layout = teamDioramaLayoutOf([
      machine('', { home: true }),
      machine('m2', { members: ['a', 'b'] })
    ])
    const views = new Map([
      ['a', dioramaPlotViewOf(member('a'), 1)],
      ['b', dioramaPlotViewOf(member('b'), 2)]
    ])
    const spots = dioramaActivitySpotsOf(layout, views)
    const island = layout.islands.find((i) => i.key === 'm2')!
    expect(spots).toHaveLength(1)
    expect(spots[0]!.kind).toBe('fish')
    expect(spots[0]!.at[1]).toBeGreaterThan(island.rect.z + island.rect.hd)
  })

  it('sends free and resting members past the home plots to their spots, though they have no plot', () => {
    const members = ['1', '2', '3', '4', '5', '6', 'r', 'f']
    const layout = teamDioramaLayoutOf([machine('', { home: true, members, cap: null })])
    expect(layout.overflow).toEqual(['r', 'f'])
    const views = new Map([
      ...['1', '2', '3', '4', '5', '6'].map(
        (key) => [key, dioramaPlotViewOf(member(key, { activity: 'working' }))] as const
      ),
      ['r', dioramaPlotViewOf(member('r', { activity: 'blocked', hold: 'limited' }))] as const,
      ['f', dioramaPlotViewOf(member('f'), 0)] as const
    ])
    const spots = dioramaActivitySpotsOf(layout, views)
    expect(spots.map((s) => [s.key, s.kind])).toEqual([
      ['r', 'rest'],
      ['f', 'fish']
    ])
  })

  it('leaves working members at their plots', () => {
    const layout = teamDioramaLayoutOf([machine('', { home: true, members: ['w'], cap: null })])
    const views = new Map([['w', dioramaPlotViewOf(member('w', { activity: 'working' }))]])
    expect(dioramaActivitySpotsOf(layout, views)).toEqual([])
  })
})
