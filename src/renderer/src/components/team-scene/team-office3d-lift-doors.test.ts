import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  office3dCab,
  office3dCabFloorAt
} from '../../../../shared/team-scene/team-office3d-elevator'
import {
  OFFICE3D_CALL,
  OFFICE3D_DOOR_Z,
  office3dLobbyOf,
  teamOffice3dLayoutOf,
  type Office3dPoint
} from '../../../../shared/team-scene/team-office3d-layout'
import {
  office3dTraffic,
  office3dTrafficRead,
  type Office3dTraffic
} from '../../../../shared/team-scene/team-office3d-traffic'
import { office3dWalkerAt } from '../../../../shared/team-scene/team-office3d-walkers'
import type { TeamSceneFloor } from '../../../../shared/team-scene/team-scene-floors'
import type {
  TeamSceneInput,
  TeamSceneMemberInput
} from '../../../../shared/team-scene/team-scene-types'
import { office3dLiftAt } from './team-office3d-lift-doors'

describe('the lift panels and doors', () => {
  // Review ORCA-1319, second pass: the lobby's talk spots sit on the call line's depth.
  it('leaves the lobby panel dark while two idle members talk, with the cab elsewhere', () => {
    const talk = office3dLobbyOf(14).talk
    const talkers = talk.map((s) => ({ floor: 0, at: s.at, pose: 'stand' }))
    expect(office3dLiftAt(talkers, office3dCab(2), 10, 3).lit[0]).toBe(false)
  })

  it('lights the panel for whoever presses it or waits in its line', () => {
    const line = [
      { floor: 0, at: OFFICE3D_CALL, pose: 'call' },
      { floor: 0, at: [OFFICE3D_CALL[0] + 1.2, OFFICE3D_CALL[1]] as [number, number], pose: 'idle' }
    ]
    expect(office3dLiftAt(line, office3dCab(2), 10, 3).lit).toEqual([true, false, false])
    expect(office3dLiftAt(line.slice(1), office3dCab(2), 10, 3).lit[0]).toBe(true)
  })
})

const host = (name: string): TeamHost =>
  name ? { kind: 'remote', name, environmentId: `env-${name}`, reachable: true } : { kind: 'local' }
const floor = (key: string, keys: string[]): TeamSceneFloor => ({
  key,
  host: host(key),
  members: keys.map((paneKey) => ({ paneKey }) as unknown as TeamMemberCard),
  cap: 5,
  running: keys.length,
  reachable: true,
  lead: key === '',
  taken: 0,
  free: 5 - keys.length
})
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

// The doorway in each floor's side wall (team-office3d-floor.ts): x -0.3..0, 1.68 wide.
const inDoorway = (at: Office3dPoint) =>
  at[0] > -0.45 && at[0] < 0.3 && Math.abs(at[1] - OFFICE3D_DOOR_Z) < 0.84
const inShaft = (at: Office3dPoint) => at[0] < -0.3 && Math.abs(at[1] - OFFICE3D_DOOR_Z) < 1

/** Every 20 ms: who steps through a floor's lift doorway, or in or out of the cab, sees its doors
 * fully open, and the cab there. */
function expectDoorsOpen(
  traffic: Office3dTraffic,
  floors: number,
  to: number,
  only?: string,
  from = 0
) {
  let crossings = 0
  for (let t = from; t <= to; t += 0.02) {
    const walkers = [
      ['lead', traffic.lead!] as const,
      ...[...traffic.members].map(([k, m]) => [k, m.plan] as const)
    ].map(([key, plan]) => ({ key, plan, ...office3dWalkerAt(plan, t) }))
    const lift = office3dLiftAt(walkers, traffic.cab!, t, floors)
    for (const w of walkers.filter((x) => !only || x.key === only)) {
      const step = w.plan.steps.find((s) => t >= s.start && t < s.start + s.dur)
      if (
        step?.kind === 'ride' ||
        w.pose === 'gone' ||
        Math.abs(w.floor - Math.round(w.floor)) > 0.01
      ) {
        continue
      }
      const fi = Math.round(w.floor)
      if (inDoorway(w.at)) {
        crossings += 1
        expect(lift.open[fi], `${w.key} in floor ${fi}'s doorway at ${t.toFixed(2)}`).toBe(1)
      }
      if (inShaft(w.at) && w.pose === 'walk') {
        expect(lift.open[fi], `${w.key} steps in floor ${fi}'s cab at ${t.toFixed(2)}`).toBe(1)
      }
      if (inShaft(w.at)) {
        expect(
          office3dCabFloorAt(traffic.cab!, t),
          `${w.key} in floor ${fi}'s shaft at ${t.toFixed(2)}`
        ).toBeCloseTo(fi, 3)
      }
    }
  }
  return crossings
}

// Owner, ORCA-1374: members and the lead stepped into the lift before its doors opened.
describe('boarding and leaving the cab', () => {
  const building = teamOffice3dLayoutOf(
    [floor('', ['a', 'b']), floor('koombea', ['c']), floor('m1', ['d'])],
    { leadAdvisor: false }
  )
  const team = [member('a'), member('b'), member('c'), member('d')]

  it('waits for the doors to open when the cab is called from another floor', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, building, input(team), 0, 'normal')
    // c goes down for a coffee: the cab, parked at the lead's floor, comes up for it first.
    const rest = [member('a'), member('b'), member('c', { activity: 'resting' }), member('d')]
    office3dTrafficRead(traffic, building, input(rest), 1, 'normal')
    expect(expectDoorsOpen(traffic, building.floors.length, 60)).toBeGreaterThan(0)
  })

  it('holds the lead at the panel until the doors open, though it reaches them as the cab does', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, building, input(team), 0, 'normal')
    const busy = [member('a'), member('b'), member('c', { activity: 'resting' }), member('d')]
    office3dTrafficRead(traffic, building, input(busy), 1, 'normal')
    const red = [member('a'), member('b'), member('c', { activity: 'resting' })]
    office3dTrafficRead(
      traffic,
      building,
      input([...red, member('d', { ci: 'failure' })]),
      2,
      'normal'
    )
    expect(expectDoorsOpen(traffic, building.floors.length, 120, 'lead')).toBeGreaterThan(0)
  })

  it('lets a member called back mid-ride step out only once the doors open', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, building, input(team), 0, 'normal')
    const rest = [member('a'), member('b'), member('c', { activity: 'resting' }), member('d')]
    office3dTrafficRead(traffic, building, input(rest), 1, 'normal')
    const ride = traffic.members.get('c')!.plan.steps.find((s) => s.kind === 'ride')!
    const mid = ride.start + ride.dur / 2
    office3dTrafficRead(traffic, building, input(team), mid, 'normal')
    expect(expectDoorsOpen(traffic, building.floors.length, 90, 'c', mid)).toBeGreaterThan(0)
  })

  it('keeps that rule when the floor the lead rides to goes away mid-ride', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, building, input(team), 0, 'normal')
    const red = [member('a'), member('b'), member('c'), member('d', { ci: 'failure' })]
    office3dTrafficRead(traffic, building, input(red), 1, 'normal')
    const ride = traffic.lead!.steps.find((s) => s.kind === 'ride')!
    const two = teamOffice3dLayoutOf([floor('', ['a', 'b']), floor('koombea', ['c'])], {
      leadAdvisor: false
    })
    const left = [member('a'), member('b'), member('c')]
    const mid = ride.start + ride.dur / 2
    office3dTrafficRead(traffic, two, input(left), mid, 'normal')
    // From the cut on: a plan made at `mid` cannot change what was drawn before it.
    expect(expectDoorsOpen(traffic, two.floors.length, 120, undefined, mid)).toBeGreaterThan(0)
  })
})
