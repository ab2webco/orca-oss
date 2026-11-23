import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../team-panel-model-types'
import { office3dCabFloorAt, office3dCabHighest } from './team-office3d-elevator'
import { teamOffice3dLayoutOf, type Office3dLayout } from './team-office3d-layout'
import { office3dTraffic, office3dTrafficRead, type Office3dTraffic } from './team-office3d-traffic'
import { office3dWalkerAt } from './team-office3d-walkers'
import type { TeamSceneFloor } from './team-scene-floors'
import type { TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

const host = (name: string): TeamHost =>
  name ? { kind: 'remote', name, environmentId: `env-${name}`, reachable: true } : { kind: 'local' }
const floor = (key: string, keys: string[], lead = key === ''): TeamSceneFloor => ({
  key,
  host: host(key),
  members: keys.map((paneKey) => ({ paneKey }) as unknown as TeamMemberCard),
  cap: 5,
  running: keys.length,
  reachable: true,
  lead,
  taken: 0,
  free: Math.max(0, 5 - keys.length)
})
const building = (...floors: TeamSceneFloor[]) =>
  teamOffice3dLayoutOf(floors, { leadAdvisor: false })
const member = (key: string, over: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false },
  ...over
})
const input = (members: TeamSceneMemberInput[]): TeamSceneInput => ({
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: null,
  members
})

// The owner's building (ORCA-1374): the lead's floor, koombea, and m1 on top.
const three = building(floor('', ['a', 'b']), floor('koombea', ['c']), floor('m1', ['d']))
const team = [member('a'), member('b'), member('c'), member('d')]
const redOnM1 = [member('a'), member('b'), member('c'), member('d', { ci: 'failure' })]

/** The time the lead's ride to `floor` is halfway up. */
const midRideTo = (traffic: Office3dTraffic, floor: number) => {
  const ride = traffic.lead!.steps.find(
    (s) =>
      s.kind === 'ride' &&
      Math.round(office3dWalkerAt(traffic.lead!, s.start + s.dur).floor) === floor
  )!
  return ride.start + ride.dur / 2
}

/** Every 50 ms from `from` to `to`: the cab and every walker stay inside `layout`'s floors. */
const expectInside = (
  traffic: Office3dTraffic,
  layout: Office3dLayout,
  from: number,
  to: number
) => {
  const top = layout.floors.length - 1
  // What the panel tells specs: the highest floor the cab is at or booked to.
  expect(office3dCabHighest(traffic.cab, from)).toBeLessThanOrEqual(top)
  for (let t = from; t <= to; t += 0.05) {
    const cab = office3dCabFloorAt(traffic.cab!, t)
    expect(cab, `cab at ${t.toFixed(2)}`).toBeLessThanOrEqual(top + 1e-6)
    expect(cab, `cab at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(-1e-6)
    for (const [key, plan] of [
      ['lead', traffic.lead!],
      ...[...traffic.members].map(([k, m]) => [k, m.plan] as const)
    ] as const) {
      const at = office3dWalkerAt(plan, t)
      if (at.pose !== 'gone') {
        expect(at.floor, `${key} at ${t.toFixed(2)}`).toBeLessThanOrEqual(top + 1e-6)
      }
    }
  }
}

describe('the 3D Office lift when a floor appears or disappears mid-ride (ORCA-1374)', () => {
  it('stays inside the building when the top floor goes away while the lead rides up to it', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, three, input(team), 0, 'normal')
    office3dTrafficRead(traffic, three, input(redOnM1), 10, 'normal')
    const mid = midRideTo(traffic, 3)
    // d finished: m1 has none of ours, so its floor is no longer drawn.
    const two = building(floor('', ['a', 'b']), floor('koombea', ['c']))
    const left = [member('a'), member('b'), member('c')]
    office3dTrafficRead(traffic, two, input(left), mid, 'normal')
    expectInside(traffic, two, mid, mid + 120)
    const end = office3dWalkerAt(traffic.lead!, mid + 120)
    expect([end.pose, end.floor]).toEqual(['desk', 1])
  })

  it('never sends the cab above the top to fetch the last member of a floor that went away', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, three, input(team), 0, 'normal')
    const two = building(floor('', ['a', 'b']), floor('koombea', ['c']))
    office3dTrafficRead(traffic, two, input([member('a'), member('b'), member('c')]), 10, 'normal')
    expectInside(traffic, two, 10, 120)
  })

  it('takes the lead to its member floor when a floor appears below it mid-ride', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, three, input(team), 0, 'normal')
    office3dTrafficRead(traffic, three, input(redOnM1), 10, 'normal')
    const mid = midRideTo(traffic, 3)
    // A new machine sorts before m1, so m1 moves up one.
    const four = building(
      floor('', ['a', 'b']),
      floor('koombea', ['c']),
      floor('nube', ['e']),
      floor('m1', ['d'])
    )
    office3dTrafficRead(traffic, four, input([...redOnM1, member('e')]), mid, 'normal')
    expectInside(traffic, four, mid, mid + 120)
    const talk = traffic.lead!.steps.find((s) => s.kind === 'hold' && s.pose === 'talk')
    expect(talk?.kind === 'hold' && talk.floor).toBe(4)
    // d's floor only moved: it stays at its desk instead of riding to its new number.
    expect(traffic.members.get('d')!.plan.steps.some((s) => s.kind === 'ride')).toBe(false)
  })

  it("ends at its new desk when the lead's machine changes mid-ride", () => {
    // A wide floor of its own, so its old desk stands past the new floor's office.
    const many = ['a', 'b', 'f', 'g', 'h', 'i', 'j']
    const before = building(floor('', many), floor('koombea', ['c']), floor('m1', ['d']))
    const crew = [...many.map((k) => member(k)), member('c')]
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, before, input([...crew, member('d')]), 0, 'normal')
    const red = input([...crew, member('d', { ci: 'failure' })])
    office3dTrafficRead(traffic, before, red, 10, 'normal')
    const mid = midRideTo(traffic, 3)
    const moved = building(
      floor('koombea', ['c'], true),
      floor('', many, false),
      floor('m1', ['d'])
    )
    office3dTrafficRead(traffic, moved, red, mid, 'normal')
    expectInside(traffic, moved, mid, mid + 120)
    const end = office3dWalkerAt(traffic.lead!, mid + 120)
    expect(end.pose).toBe('desk')
    expect(end.floor).toBe(1)
    expect(end.at[0]).toBeCloseTo(moved.floors[1]!.office!.desk[0], 5)
  })
})
