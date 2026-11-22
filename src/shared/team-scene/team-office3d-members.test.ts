import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../team-panel-model-types'
import {
  OFFICE3D_DOOR_Z,
  OFFICE3D_SEAT_Z,
  OFFICE3D_WING_WIDTH,
  office3dLobbyOf,
  teamOffice3dLayoutOf,
  type Office3dLayout,
  type Office3dPoint
} from './team-office3d-layout'
import { office3dMemberAt } from './team-office3d-members'
import { office3dWaitOf } from './team-office3d-places'
import { office3dSlotId } from './team-office3d-slots'
import { office3dTraffic, office3dTrafficRead } from './team-office3d-traffic'
import type { Office3dStep } from './team-office3d-walkers'

type Office3dStepLike = Office3dStep
import type { TeamSceneFloor } from './team-scene-floors'
import type { TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

const host = (name: string): TeamHost =>
  name ? { kind: 'remote', name, environmentId: `env-${name}`, reachable: true } : { kind: 'local' }
const floor = (key: string, keys: string[]): TeamSceneFloor => ({
  key,
  host: host(key),
  members: keys.map((paneKey) => ({ paneKey }) as unknown as TeamMemberCard),
  cap: 6,
  running: keys.length,
  reachable: true,
  lead: key === '',
  taken: 0,
  free: 6 - keys.length
})
const layout = teamOffice3dLayoutOf([floor('', ['a', 'b']), floor('m2', ['c', 'd', 'e', 'f'])], {
  leadAdvisor: false
})
const m = (key: string, over: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
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
const all = ['a', 'b', 'c', 'd', 'e', 'f']
const team = (over: Record<string, Partial<TeamSceneMemberInput>> = {}) =>
  input(all.map((k) => m(k, over[k])))

/** Reads `team()` at 0, then each of `reads` at its time; returns the traffic. */
function play(reads: [number, TeamSceneInput][], l: Office3dLayout = layout) {
  const traffic = office3dTraffic()
  office3dTrafficRead(traffic, l, team(), 0, 'normal')
  for (const [now, read] of reads) {
    office3dTrafficRead(traffic, l, read, now, 'normal')
  }
  return traffic
}
const where = (traffic: ReturnType<typeof play>, key: string, t: number) =>
  office3dMemberAt(traffic.members.get(key)!, t)

// One test per row of the ORCA-1317 table (owner's corrections and the data check, 2026-11-21).
describe('3D Office members, by event', () => {
  it('seats everyone at their place on the first read, without walking', () => {
    const traffic = play([])
    for (const key of all) {
      expect(where(traffic, key, 0.1)).toMatchObject({ pose: 'desk' })
    }
  })

  it('rides down to the games room when it has nothing to do, and sits or stands there', () => {
    const traffic = play([[10, team({ c: { activity: 'resting' } })]])
    expect(where(traffic, 'c', 10.05).pose).toBe('walk')
    const there = where(traffic, 'c', 120)
    expect(there.floor).toBe(0)
    expect(there.slot?.kind).toMatch(/console|paddle|talk/)
    expect(traffic.members.get('c')!.plan.steps.some((s) => s.kind === 'ride')).toBe(true)
  })

  // Why 1.3: under reduced motion the stage draws one still frame at t = 1.3, long before any read.
  it('holds its seat in a still frame drawn before its trip, where it is drawn seated', () => {
    // Reads run on the page's clock, minutes after the still frame's moment.
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, layout, team(), 400, 'normal')
    office3dTrafficRead(traffic, layout, team({ c: { activity: 'resting' } }), 500, 'normal')
    const still = where(traffic, 'c', 1.3)
    const settled = where(traffic, 'c', 1e4)
    expect(still.at).toEqual(settled.at)
    expect(still.slot).not.toBeNull()
    expect(still.slot).toBe(settled.slot)
  })

  it('goes straight back to its desk on the same tick it starts working again', () => {
    const traffic = play([
      [10, team({ c: { activity: 'resting' } })],
      [100, team()]
    ])
    // Right after the read it is already walking, and it ends at its desk.
    expect(where(traffic, 'c', 100.05).pose).not.toBe('sit')
    expect(where(traffic, 'c', 100.05).pose).not.toBe('stand')
    expect(where(traffic, 'c', 300)).toMatchObject({ pose: 'desk', floor: 2 })
    // Never sits down in a room again on the way.
    for (let t = 100.05; t < 300; t += 0.25) {
      const p = where(traffic, 'c', t).pose
      expect(p === 'sit' || p === 'stand', `${p} at ${t.toFixed(2)}`).toBe(false)
    }
  })

  it('turns back at once when work comes while it is still walking to a room', () => {
    const traffic = play([
      [10, team({ a: { activity: 'resting' } })],
      [12, team()]
    ])
    expect(where(traffic, 'a', 12.05).pose).toBe('walk')
    expect(where(traffic, 'a', 200)).toMatchObject({ pose: 'desk', floor: 1 })
  })

  it("goes to the lead's office for an Inbox question, and stays at its desk for a pane prompt", () => {
    const traffic = play([
      [10, team({ c: { activity: 'needsYou' }, d: { activity: 'needsYou', paneAsk: true } })]
    ])
    const c = where(traffic, 'c', 200)
    expect(c).toMatchObject({ pose: 'sit', floor: 1 })
    expect(c.slot?.kind).toBe('guest')
    expect(where(traffic, 'd', 200).pose).toBe('desk')
  })

  it('waits out its quota in the cafeteria', () => {
    const traffic = play([[10, team({ a: { activity: 'blocked', hold: 'limited' } })]])
    expect(where(traffic, 'a', 200)).toMatchObject({ pose: 'sit', floor: 0 })
    expect(where(traffic, 'a', 200).slot?.kind).toBe('cafe')
  })

  it('waits while its CI runs where its pick for that wait says, and keeps the pick', () => {
    const waiting = { activity: 'done' as const, ci: 'pending' as const }
    const traffic = play([
      [10, team({ a: waiting })],
      [30, team({ a: { ...waiting, reportId: 'r' } })]
    ])
    const pick = office3dWaitOf('a', '10')
    const at = where(traffic, 'a', 200)
    expect(at.slot?.kind ?? 'desk').toMatch(
      pick === 'desk' ? /desk/ : pick === 'cafe' ? /cafe/ : /console|paddle|talk/
    )
    expect(traffic.members.get('a')!.wait).toBe(pick)
  })

  it('comes back to its desk when its CI goes green', () => {
    const traffic = play([
      [10, team({ c: { activity: 'done', ci: 'pending' } })],
      [60, team({ c: { activity: 'done', ci: 'success' } })]
    ])
    expect(where(traffic, 'c', 300)).toMatchObject({ pose: 'desk', floor: 2 })
  })

  it('comes back to its desk when its CI goes red', () => {
    const traffic = play([
      [10, team({ c: { activity: 'done', ci: 'pending' } })],
      [60, team({ c: { activity: 'done', ci: 'failure' } })]
    ])
    expect(where(traffic, 'c', 300)).toMatchObject({ pose: 'desk', floor: 2 })
  })

  it('is available in the games room once merged', () => {
    const traffic = play([[10, team({ a: { activity: 'done', mergedPr: 4 } })]])
    expect(where(traffic, 'a', 200).slot?.kind).toMatch(/console|paddle|talk/)
  })

  it('walks out of the building when its session closes, and is gone after', () => {
    const traffic = play([[10, input(all.filter((k) => k !== 'f').map((k) => m(k)))]])
    expect(where(traffic, 'f', 300)).toMatchObject({ pose: 'gone', floor: 0 })
    office3dTrafficRead(
      traffic,
      layout,
      input(all.filter((k) => k !== 'f').map((k) => m(k))),
      400,
      'normal'
    )
    expect(traffic.members.has('f')).toBe(false)
  })

  it('comes in from the street door and rides up to its desk when it joins', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(
      traffic,
      layout,
      input(all.filter((k) => k !== 'f').map((k) => m(k))),
      0,
      'normal'
    )
    office3dTrafficRead(traffic, layout, team(), 10, 'normal')
    const door = office3dLobbyOf(layout.floors[0]!.width).door
    const start = where(traffic, 'f', 10.01)
    expect(start.floor).toBe(0)
    expect(Math.hypot(start.at[0] - door[0], start.at[1] - door[1])).toBeLessThan(0.3)
    expect(where(traffic, 'f', 300)).toMatchObject({ pose: 'desk', floor: 2 })
  })

  it('queues at the call panel and boards in order, three to a cab', () => {
    const idle = { activity: 'resting' as const }
    const traffic = play([[10, team({ c: idle, d: idle, e: idle, f: idle })]])
    // Everyone goes down, never more than three to a cab, one cab after another. (The cap itself
    // is proven by the cab test: here departures are staggered, so the line splits by timing.)
    const rides = traffic.cab!.rides.filter((r) => r.from === 2 && r.to === 0)
    expect(rides.reduce((n, r) => n + (r.riders ?? 0), 0)).toBe(4)
    expect(rides.every((r) => (r.riders ?? 0) <= 3)).toBe(true)
    for (let i = 1; i < rides.length; i++) {
      expect(rides[i]!.start).toBeGreaterThanOrEqual(rides[i - 1]!.end)
    }
  })
})

// Footprints from the drawing's numbers; seats (chairs, the couch) are where figures sit.
type Rect = { name: string; x0: number; x1: number; z0: number; z1: number }
const BODY = 0.2
const rect = (name: string, x: number, z: number, w: number, d: number): Rect => ({
  name,
  x0: x - w / 2,
  x1: x + w / 2,
  z0: z - d / 2,
  z1: z + d / 2
})
const solidsOf = (l: Office3dLayout, floor: number): Rect[] => {
  const f = l.floors[floor]!
  const out: Rect[] = [
    rect('side wall', -0.15, (OFFICE3D_DOOR_Z - 0.85) / 2, 0.3, OFFICE3D_DOOR_Z - 0.85)
  ]
  for (const seat of f.seats) {
    out.push(rect('desk', seat.x, OFFICE3D_SEAT_Z - 0.95 * f.scale, 2 * f.scale, 1.1 * f.scale))
  }
  if (f.lobby) {
    const L = office3dLobbyOf(f.width)
    out.push(rect('counter', L.counter.x, L.counter.z, L.counter.w, L.counter.d))
    for (const [x, z] of L.tables) {
      out.push(rect('table', x, z, 1.1, 1.1))
    }
    out.push(rect('tv stand', L.tv[0], L.tv[1] + 0.15, 1.6, 0.45))
    out.push(rect('table tennis', L.pingpong.x, L.pingpong.z, L.pingpong.w, L.pingpong.d))
  }
  if (f.office) {
    out.push(rect("lead's desk", f.office.x + OFFICE3D_WING_WIDTH / 2, 2.6, 2.1, 0.95))
  }
  return out
}
const inside = (p: Office3dPoint, s: Rect) =>
  p[0] > s.x0 - BODY && p[0] < s.x1 + BODY && p[1] > s.z0 - BODY && p[1] < s.z1 + BODY

describe('3D Office members never walk through anything', () => {
  it('on every trip of a busy day: rooms, the office, red CI, back to work, leaving', () => {
    const idle = { activity: 'resting' as const }
    const traffic = play([
      [
        10,
        team({
          a: idle,
          c: { activity: 'needsYou' },
          d: idle,
          e: { activity: 'done', ci: 'pending' }
        })
      ],
      [
        40,
        team({ a: { activity: 'blocked', hold: 'limited' }, c: { activity: 'needsYou' }, f: idle })
      ],
      [70, team({ d: { activity: 'done', ci: 'failure' }, f: idle })],
      [90, input(['a', 'b', 'c', 'd', 'e'].map((k) => m(k)))]
    ])
    for (const [key, member] of traffic.members) {
      for (let t = 0; t < 400; t += 0.1) {
        const at = office3dMemberAt(member, t)
        if (at.pose === 'gone' || Math.abs(at.floor - Math.round(at.floor)) > 0.01) {
          continue
        }
        const hit = solidsOf(layout, Math.round(at.floor)).find((s) => inside(at.at, s))
        expect(hit, `${key} in ${hit?.name} at ${t.toFixed(1)}`).toBeUndefined()
      }
    }
  })
})

describe('the call-panel line', () => {
  it('never puts two people, the lead included, on one spot at once', () => {
    const traffic = office3dTraffic()
    const l = teamOffice3dLayoutOf(
      [floor('', ['a', 'b', 'c', 'g', 'h']), floor('m2', ['d', 'e'])],
      {
        leadAdvisor: false
      }
    )
    const keys = ['a', 'b', 'c', 'g', 'h', 'd', 'e']
    office3dTrafficRead(traffic, l, input(keys.map((k) => m(k))), 0, 'normal')
    const idle = { activity: 'resting' as const }
    office3dTrafficRead(
      traffic,
      l,
      input([
        m('a'),
        m('b', idle),
        m('c', idle),
        m('g', { activity: 'blocked', hold: 'limited' }),
        m('h', idle),
        m('d', { activity: 'needsYou' }),
        m('e', { activity: 'done', ci: 'failure' })
      ]),
      1,
      'normal'
    )
    type Wait = { who: string; x: number; floor: number; from: number; to: number }
    const waits: Wait[] = []
    const add = (who: string, steps: { kind: string }[]) => {
      for (const s of steps as Extract<Office3dStepLike, { kind: 'hold' }>[]) {
        if (s.kind === 'hold' && s.face && (s.pose === 'call' || s.pose === 'idle') && s.dur > 0) {
          waits.push({ who, x: s.at[0], floor: s.floor, from: s.start, to: s.start + s.dur })
        }
      }
    }
    for (const [key, member] of traffic.members) {
      add(key, member.plan.steps)
    }
    add('lead', traffic.lead!.steps)
    for (const a of waits) {
      for (const b of waits) {
        if (a.who < b.who && a.floor === b.floor && a.from < b.to && b.from < a.to) {
          expect(Math.abs(a.x - b.x), `${a.who} and ${b.who} share a spot`).toBeGreaterThan(1)
        }
      }
    }
  })
})

// Review ORCA-1319, finding 4: a seated member got up when someone earlier in the order joined.
describe('a seat already taken', () => {
  it('stays with its occupant when someone else joins the room', () => {
    const out = { activity: 'blocked' as const, hold: 'limited' as const }
    const traffic = play([
      [10, team({ e: out })],
      [100, team({ c: out, e: out })]
    ])
    const seat = traffic.members.get('e')!.slot
    expect(seat?.kind).toBe('cafe')
    // e's own state did not change, so it never stands up.
    for (let t = 60; t < 140; t += 0.5) {
      expect(where(traffic, 'e', t).pose, `e moved at ${t}`).toBe('sit')
    }
    expect(office3dSlotId(traffic.members.get('e')!.slot)).toBe(office3dSlotId(seat))
    expect(office3dSlotId(traffic.members.get('c')!.slot)).not.toBe(office3dSlotId(seat))
  })
})
