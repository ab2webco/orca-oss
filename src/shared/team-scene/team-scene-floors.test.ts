import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMachine, TeamMemberCard, TeamSection } from '../team-panel-model-types'
import { teamSceneFloorInputOf, teamSceneFloorsOf, teamSceneRideOf } from './team-scene-floors'

const local: TeamHost = { kind: 'local' }
const remote = (name: string, reachable = true): TeamHost => ({
  kind: 'remote',
  name,
  environmentId: `env-${name}`,
  reachable
})
const card = (paneKey: string, host: TeamHost = local) =>
  ({ paneKey, host }) as unknown as TeamMemberCard
const machine = (host: TeamHost, cap: number | null, running = 0): TeamMachine => ({
  host: host.kind === 'remote' ? { ...host, environmentId: null } : host,
  running,
  cap,
  status: 'working',
  reading:
    host.kind === 'remote' && !host.reachable
      ? { kind: 'unreachable', lastSeenAt: null }
      : { kind: 'unread' }
})
const ready = (value: TeamMachine[]): TeamSection<TeamMachine[]> => ({ kind: 'ready', value })
const lead = { host: local }
const summary = (floors: ReturnType<typeof teamSceneFloorsOf>) =>
  floors.map((f) => ({
    key: f.key,
    members: f.members.map((m) => m.paneKey),
    cap: f.cap,
    running: f.running,
    reachable: f.reachable,
    lead: f.lead
  }))

describe('teamSceneFloorsOf', () => {
  it("puts each member on its own host's floor, the lead's floor first", () => {
    const members = [card('a', remote('m1')), card('b'), card('c', remote('imac')), card('d')]
    const machines = ready([
      machine(local, 5, 2),
      machine(remote('imac'), 4, 1),
      machine(remote('m1'), 3, 1)
    ])
    expect(summary(teamSceneFloorsOf({ lead, members, machines }))).toEqual([
      { key: '', members: ['b', 'd'], cap: 5, running: 2, reachable: true, lead: true },
      { key: 'imac', members: ['c'], cap: 4, running: 1, reachable: true, lead: false },
      { key: 'm1', members: ['a'], cap: 3, running: 1, reachable: true, lead: false }
    ])
  })

  it('reads one host as one floor, which the panel draws as today', () => {
    const floors = teamSceneFloorsOf({ lead, members: [card('a'), card('b')], machines: null })
    expect(summary(floors)).toEqual([
      { key: '', members: ['a', 'b'], cap: null, running: null, reachable: true, lead: true }
    ])
  })

  it('still floors a host whose members show while its machine row is missing or the tab is hidden', () => {
    const members = [card('a'), card('b', remote('m1'))]
    for (const machines of [
      null,
      { kind: 'unavailable' as const },
      ready([]),
      ready([machine(local, 5)])
    ]) {
      const floors = teamSceneFloorsOf({ lead, members, machines })
      expect(floors.map((f) => f.key)).toEqual(['', 'm1'])
      expect(floors[1]!.cap).toBeNull()
    }
  })

  it("takes a floor's reach from its machine row or from its member's card", () => {
    const machines = ready([machine(local, 5), machine(remote('m1', false), 3)])
    const floors = teamSceneFloorsOf({ lead, members: [card('a', remote('m1'))], machines })
    expect(summary(floors)[1]).toEqual({
      key: 'm1',
      members: ['a'],
      cap: 3,
      running: 0,
      reachable: false,
      lead: false
    })
    const offline = teamSceneFloorsOf({
      lead,
      members: [card('b', remote('m2', false))],
      machines: null
    })
    expect(offline[1]!.reachable).toBe(false)
  })

  it("counts other sessions' desks as taken and the rest of the cap as free, never below zero", () => {
    const desks = (cap: number | null, running: number, here: number) => {
      const members = Array.from({ length: here }, (_, i) => card(`m${i}`, remote('h')))
      const floors = teamSceneFloorsOf({
        lead,
        members,
        machines: ready([machine(local, 5), machine(remote('h'), cap, running)])
      })
      const floor = floors.find((f) => f.key === 'h')!
      return { taken: floor.taken, free: floor.free }
    }
    expect(desks(4, 3, 1)).toEqual({ taken: 2, free: 1 })
    expect(desks(4, 1, 1)).toEqual({ taken: 0, free: 3 })
    expect(desks(4, 6, 2)).toEqual({ taken: 4, free: 0 })
    expect(desks(null, 3, 1)).toEqual({ taken: 2, free: 0 })
    // Why: a count read before the team's own cards arrived never takes desks away from them.
    expect(desks(4, 0, 2)).toEqual({ taken: 0, free: 2 })
  })
})

describe('teamSceneFloorInputOf', () => {
  const base = {
    lead: { ...lead, name: 'Lead', status: 'working', condition: 'working' },
    advisor: { line: 'ok' },
    stopped: { since: null, by: 'lead' }
  }
  it('gives each floor its own members, its empty desks, and the lead, advisor and STOP only where the lead stands', () => {
    const members = [card('a'), card('b', remote('m1'))]
    const machines = ready([machine(local, 3, 1), machine(remote('m1'), 4, 2)])
    const floors = teamSceneFloorsOf({ lead, members, machines })
    const model = { ...base, members, machines } as unknown as Parameters<
      typeof teamSceneFloorInputOf
    >[0]
    const [home, away] = floors.map((floor) => teamSceneFloorInputOf(model, floor))
    expect(home!.members.map((m) => m.key)).toEqual(['a'])
    expect(home!.leadless).toBeUndefined()
    expect(home!.advisor).toEqual({ line: 'ok' })
    expect(home!.stopped).toBe(true)
    expect(home!.desks).toEqual({ taken: 0, free: 2 })
    expect(away!.members.map((m) => m.key)).toEqual(['b'])
    expect(away!.leadless).toBe(true)
    expect(away!.advisor).toBeNull()
    expect(away!.stopped).toBeUndefined()
    expect(away!.desks).toEqual({ taken: 1, free: 2 })
  })
})

// The owner's two real teams on 2026-11-10, hosts only: the dev runtime had no members on its
// three machines, the installed lead had members here and on m1, with imac and orca-contabo empty.
describe("teamSceneFloorsOf from the owner's real teams", () => {
  const dev = {
    lead,
    members: [],
    machines: ready([
      machine(local, 4, 0),
      machine(remote('M1'), 5, 0),
      machine(remote('orca-contabo'), 2, 0)
    ])
  }
  const real = {
    lead,
    members: [
      card('toadette-2'),
      card('toadette'),
      card('peach-2'),
      card('luigi', remote('m1')),
      card('mario', remote('m1')),
      card('wario-2', remote('m1'))
    ],
    machines: ready([
      machine(local, 4, 4),
      machine(remote('imac', false), 0, 0),
      machine(remote('m1'), 5, 2),
      machine(remote('orca-contabo'), 2, 0)
    ])
  }

  it('draws the single office for a team whose members are not on two machines', () => {
    expect(teamSceneFloorsOf(dev).map((f) => f.key)).toEqual([''])
    const oneHost = { ...real, members: real.members.slice(0, 3) }
    expect(teamSceneFloorsOf(oneHost).map((f) => f.key)).toEqual([''])
  })

  it('floors only the machines our members sit on, leaving empty ones to the Machines tab', () => {
    expect(teamSceneFloorsOf(real).map((f) => f.key)).toEqual(['', 'm1'])
  })
})

describe('teamSceneRideOf', () => {
  const asking = (key: string, host: TeamHost) => ({ ...card(key, host), needsYou: true })
  it('sends the lead to the first member on another floor who needs you, and nowhere else', () => {
    const members = [card('a'), card('b', remote('m1')), asking('c', remote('m1'))]
    const floors = teamSceneFloorsOf({ lead, members, machines: null })
    expect(teamSceneRideOf(floors)).toEqual({ floor: 'm1', member: 'c' })
    const home = teamSceneFloorsOf({
      lead,
      members: [asking('a', local), card('b', remote('m1'))],
      machines: null
    })
    expect(teamSceneRideOf(home)).toBeNull()
  })

  it('never rides to a floor it cannot reach', () => {
    const members = [card('a'), asking('c', remote('m1', false))]
    expect(teamSceneRideOf(teamSceneFloorsOf({ lead, members, machines: null }))).toBeNull()
  })

  it("puts the ride on both floors' inputs: away on the lead's, the guest on the member's", () => {
    const members = [card('a'), asking('c', remote('m1'))]
    const model = {
      lead: { ...lead, name: 'Lead', status: 'working', condition: 'working' },
      advisor: null,
      stopped: null,
      members,
      machines: null
    } as unknown as Parameters<typeof teamSceneFloorInputOf>[0]
    const floors = teamSceneFloorsOf({ lead, members, machines: null })
    const ride = teamSceneRideOf(floors)
    const [home, away] = floors.map((floor) => teamSceneFloorInputOf(model, floor, ride))
    expect(home!.ride).toBe('away')
    expect(away!.ride).toEqual({ guest: 'c' })
  })
})
