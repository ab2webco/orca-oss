import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../team-panel-model-types'
import type { TeamSceneFloor } from './team-scene-floors'
import {
  OFFICE3D_BALCONY_Y,
  OFFICE3D_PITCH,
  office3dFloorWidth,
  office3dHasAdvisor,
  teamOffice3dLayoutOf
} from './team-office3d-layout'

const local: TeamHost = { kind: 'local' }
const remote = (name: string): TeamHost => ({
  kind: 'remote',
  name,
  environmentId: `env-${name}`,
  reachable: true
})
const card = (paneKey: string, over: Partial<TeamMemberCard> = {}) =>
  ({ paneKey, ...over }) as unknown as TeamMemberCard
const decided = (paneKey: string) =>
  card(paneKey, { decisions: [{ id: 'd1', verdict: 'allow', gesture: null }] })
const floor = (over: Partial<TeamSceneFloor> = {}): TeamSceneFloor => ({
  key: '',
  host: local,
  members: [card('a'), card('b')],
  cap: 5,
  running: 2,
  reachable: true,
  lead: true,
  taken: 0,
  free: 3,
  ...over
})
const remoteFloor = (name: string, over: Partial<TeamSceneFloor> = {}) =>
  floor({ key: name, host: remote(name), lead: false, ...over })

describe('the 3D Office building', () => {
  it('stacks the lead floor first, then each machine a pitch apart', () => {
    const { floors } = teamOffice3dLayoutOf([floor(), remoteFloor('m2'), remoteFloor('gpu')], {
      leadAdvisor: false
    })
    expect(floors.map((f) => [f.key, f.name, f.y, f.lead])).toEqual([
      ['', '', 0, true],
      ['m2', 'm2', OFFICE3D_PITCH, false],
      ['gpu', 'gpu', 2 * OFFICE3D_PITCH, false]
    ])
  })

  it("seats members first, then other sessions' desks, then the cap's free ones", () => {
    const [f] = teamOffice3dLayoutOf([floor({ taken: 2, free: 1 })], { leadAdvisor: false }).floors
    expect(f!.seats.map((s) => [s.kind, s.key])).toEqual([
      ['member', 'a'],
      ['member', 'b'],
      ['taken', null],
      ['taken', null],
      ['free', null]
    ])
    expect(f!.used).toBe(4)
  })

  it('always draws at least five desks, and a crowded row shrinks each desk to keep its gaps', () => {
    const [small] = teamOffice3dLayoutOf([floor({ members: [card('a')], free: 0 })], {
      leadAdvisor: false
    }).floors
    expect(small!.seats).toHaveLength(5)
    expect(small!.scale).toBe(1)
    const crowd = Array.from({ length: 9 }, (_, i) => card(`m${i}`))
    const [big] = teamOffice3dLayoutOf([floor({ members: crowd, free: 0 })], {
      leadAdvisor: false
    }).floors
    expect(big!.seats).toHaveLength(9)
    expect(big!.width).toBe(office3dFloorWidth(9))
    expect(big!.scale).toBeLessThan(1)
    const xs = big!.seats.map((s) => s.x)
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1]!)).toBe(true)
    expect(xs.at(-1)).toBeLessThan(big!.width)
  })

  it('keeps each member on its desk when another leaves, and a newcomer takes the hole', () => {
    const first = teamOffice3dLayoutOf([floor({ members: [card('a'), card('b'), card('c')] })], {
      leadAdvisor: false
    })
    const after = teamOffice3dLayoutOf([floor({ members: [card('a'), card('c'), card('d')] })], {
      leadAdvisor: false,
      previous: first.order
    })
    expect(after.floors[0]!.seats.slice(0, 3).map((s) => s.key)).toEqual(['a', 'd', 'c'])
  })

  it("puts the lead's office on the lead's floor only", () => {
    const { floors } = teamOffice3dLayoutOf([floor(), remoteFloor('m2')], { leadAdvisor: false })
    expect(floors[0]!.office?.x).toBe(floors[0]!.width)
    expect(floors[1]!.office).toBeNull()
  })
})

describe('one Jev per machine, only where its plugin has spoken', () => {
  it("draws the lead floor's Jev from the team's Jev row", () => {
    expect(office3dHasAdvisor(floor(), true)).toBe(true)
    expect(office3dHasAdvisor(floor(), false)).toBe(false)
  })

  it("draws another floor's Jev from a decision in one of its panes, never the lead's line", () => {
    expect(office3dHasAdvisor(remoteFloor('m2'), true)).toBe(false)
    expect(
      office3dHasAdvisor(remoteFloor('m2', { members: [card('a'), decided('b')] }), false)
    ).toBe(true)
  })

  it('gives a floor without its Jev no control room, and the lead floor a balcony', () => {
    const { floors } = teamOffice3dLayoutOf(
      [floor(), remoteFloor('m2', { members: [decided('x')] }), remoteFloor('gpu')],
      { leadAdvisor: true }
    )
    expect(floors[0]!.controlRoom).toMatchObject({ balcony: true, y: OFFICE3D_BALCONY_Y })
    expect(floors[1]!.controlRoom).toMatchObject({ balcony: false, y: OFFICE3D_PITCH })
    expect(floors[2]!.controlRoom).toBeNull()
  })
})
