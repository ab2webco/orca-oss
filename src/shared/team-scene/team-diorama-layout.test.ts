import { describe, expect, it } from 'vitest'
import {
  DIORAMA_HOME_PLOTS,
  stableOrderOf,
  teamDioramaLayoutOf,
  teamDioramaMachinesOf,
  type DioramaMachine
} from './team-diorama-layout'
import type { TeamMemberCard } from '../team-panel-model-types'
import type { TeamSceneFloor } from './team-scene-floors'

const machine = (key: string, over: Partial<DioramaMachine> = {}): DioramaMachine => ({
  key,
  name: key,
  home: false,
  reachable: true,
  members: [],
  cap: null,
  taken: 0,
  ...over
})
const HOME = machine('', { home: true, members: ['lead-pane', 'a'] })
const card = (paneKey: string, host: TeamMemberCard['host']): TeamMemberCard => ({
  paneKey,
  terminalHandle: null,
  worktreeId: null,
  host,
  name: paneKey,
  agentType: 'claude',
  status: 'working',
  condition: 'working',
  since: null,
  liveAction: null,
  model: null,
  account: null,
  characterKey: null,
  ticket: null,
  flowPhase: 'code',
  summary: null,
  pr: null,
  needsYou: false,
  limitResetsAt: null,
  found: false
})
const plotKeysOf = (layout: ReturnType<typeof teamDioramaLayoutOf>, key: string) =>
  layout.islands.find((i) => i.key === key)!.plots.map((p) => p.key)

describe('the diorama layout', () => {
  it('sizes an island by its machine cap: one, two or three plots across', () => {
    const layout = teamDioramaLayoutOf([
      HOME,
      machine('s', { cap: 1, members: ['s1'] }),
      machine('m', { cap: 2, members: ['m1'] }),
      machine('l', { cap: 3, members: ['l1', 'l2'] })
    ])
    const widthOf = (key: string) => layout.islands.find((i) => i.key === key)!.rect.hw * 2
    expect([widthOf('s'), widthOf('m'), widthOf('l')]).toEqual([6.5, 9.8, 13.1])
    const large = layout.islands.find((i) => i.key === 'l')!
    expect(large.plots.map((p) => p.key)).toEqual(['l1', 'l2', null])
  })

  it('marks the seats other sessions hold as taken, after its own members', () => {
    const layout = teamDioramaLayoutOf([HOME, machine('m2', { cap: 3, members: ['x'], taken: 1 })])
    const plots = layout.islands.find((i) => i.key === 'm2')!.plots
    expect(plots.map((p) => [p.key, p.taken])).toEqual([
      ['x', false],
      [null, true],
      [null, false]
    ])
  })

  it('never moves the islands already there when a machine joins', () => {
    const before = teamDioramaLayoutOf([HOME, machine('a', { cap: 2 }), machine('b', { cap: 1 })])
    const after = teamDioramaLayoutOf(
      [HOME, machine('new', { cap: 3 }), machine('a', { cap: 2 }), machine('b', { cap: 1 })],
      before.order
    )
    for (const key of ['a', 'b']) {
      expect(after.islands.find((i) => i.key === key)!.rect).toEqual(
        before.islands.find((i) => i.key === key)!.rect
      )
    }
  })

  it('keeps each member on its plot, and gives a left plot to the next newcomer', () => {
    const first = teamDioramaLayoutOf([machine('', { home: true, members: ['a', 'b', 'c'] })])
    const next = teamDioramaLayoutOf(
      [machine('', { home: true, members: ['c', 'd', 'a'] })],
      first.order
    )
    const keys = next.islands[0]!.plots.map((p) => p.key)
    expect(keys.slice(0, 3)).toEqual(['a', 'd', 'c'])
  })

  it('reports home members past its six plots instead of hiding them', () => {
    const members = ['1', '2', '3', '4', '5', '6', '7']
    const layout = teamDioramaLayoutOf([machine('', { home: true, members })])
    expect(layout.islands[0]!.plots).toHaveLength(DIORAMA_HOME_PLOTS.length)
    expect(layout.overflow).toEqual(['7'])
  })

  it("reports remote members past an island's six plots instead of dropping them", () => {
    const members = ['1', '2', '3', '4', '5', '6', '7']
    const layout = teamDioramaLayoutOf([HOME, machine('gpu', { members })])
    expect(plotKeysOf(layout, 'gpu')).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(layout.overflow).toEqual(['7'])
  })

  it("moves a member into a free plot when its machine's cap shrinks under it", () => {
    const first = teamDioramaLayoutOf([HOME, machine('gpu', { cap: 3, members: ['a', 'b', 'c'] })])
    const left = teamDioramaLayoutOf(
      [HOME, machine('gpu', { cap: 3, members: ['c'] })],
      first.order
    )
    expect(left.order.plots['gpu']).toEqual([null, null, 'c'])
    const shrunk = teamDioramaLayoutOf(
      [HOME, machine('gpu', { cap: 2, members: ['c'] })],
      left.order
    )
    expect(plotKeysOf(shrunk, 'gpu')).toEqual(['c', null])
    expect(shrunk.overflow).toEqual([])
  })

  it('gives each column of islands one home dock and each island its own', () => {
    const layout = teamDioramaLayoutOf([
      HOME,
      machine('a'),
      machine('b'),
      machine('c'),
      machine('d')
    ])
    expect(Object.keys(layout.homeDocks).sort()).toEqual(['0', '1', '2'])
    for (const island of layout.islands.filter((i) => !i.home)) {
      expect(island.dock!.boat[1]).toBeLessThan(island.rect.z - island.rect.hd)
    }
  })

  it('reads a floor as a machine with its members, cap and other sessions', () => {
    const host = { kind: 'remote', name: 'gpu', environmentId: null, reachable: false } as const
    const floor: TeamSceneFloor = {
      key: 'gpu',
      host,
      members: [card('p1', host)],
      cap: 3,
      running: 2,
      reachable: false,
      lead: false,
      taken: 1,
      free: 1
    }
    expect(teamDioramaMachinesOf([floor])).toEqual([
      { key: 'gpu', name: 'gpu', home: false, reachable: false, members: ['p1'], cap: 3, taken: 1 }
    ])
  })
})

describe('stableOrderOf', () => {
  it('keeps places, fills holes first, and drops trailing holes', () => {
    expect(stableOrderOf(['b', 'c'], ['a', 'b'])).toEqual(['c', 'b'])
    expect(stableOrderOf(['a'], ['a', 'b', 'c'])).toEqual(['a'])
  })
})
