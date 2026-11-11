import { describe, expect, it } from 'vitest'
import {
  advisorLineShown,
  applyTeamSceneInput,
  createTeamSceneWorld,
  drainTeamSceneEffects,
  settleTeamScene,
  stepTeamScene,
  type TeamSceneWorld
} from './team-scene-director'
import { teamSceneActors } from './team-scene-actors'
import { drainTeamSceneBoarded } from './team-scene-elevator'
import type { TeamSceneActor, TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

const WIDTH = 360
const DT = 1 / 30
const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
const member = (key: string, extra: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  site: { stage: 0, broken: false },
  ...extra
})
const input = (members: TeamSceneMemberInput[], advisorLine?: string): TeamSceneInput => ({
  lead,
  advisor: advisorLine === undefined ? null : { line: advisorLine },
  members
})

const actor = (world: TeamSceneWorld, key: string): TeamSceneActor | undefined =>
  teamSceneActors(world).find((a) => a.key === key)

function runUntil(world: TeamSceneWorld, done: () => boolean, seconds = 30): boolean {
  for (let t = 0; t < seconds; t += DT) {
    stepTeamScene(world, DT, { width: WIDTH })
    if (done()) {
      return true
    }
  }
  return false
}

function seated(keys: string[]): TeamSceneWorld {
  const world = createTeamSceneWorld()
  applyTeamSceneInput(world, input(keys.map((k) => member(k))))
  return world
}

describe('team scene director', () => {
  it('places the first snapshot at its seats without an entrance', () => {
    const world = seated(['a', 'b'])
    expect(actor(world, 'a')?.pose).toBe('work')
    expect(actor(world, 'lead')?.role).toBe('lead')
    expect(actor(world, 'advisor')).toBeUndefined()
    expect(teamSceneActors(world).map((a) => a.depth)).toEqual(
      teamSceneActors(world)
        .map((a) => a.depth)
        .sort((p, q) => p - q)
    )
  })

  it('keeps one station per seat for styles to draw', () => {
    const world = seated(['a', 'b', 'c'])
    expect(world.stations).toHaveLength(3)
    expect(world.stations[0]).toEqual({ x: actor(world, 'a')?.x, depth: actor(world, 'a')?.depth })
  })

  it('keeps every seat clear of the advisor, so a full team never hides it', () => {
    const world = createTeamSceneWorld()
    const eight = Array.from({ length: 8 }, (_, i) => member(`m${i}`))
    applyTeamSceneInput(world, input(eight, 'watching CI'))
    const advisor = actor(world, 'advisor')!
    for (const seat of world.stations) {
      // 0.06 of the width is ~19 px at 320, past half a figure on either side.
      expect(Math.abs(seat.x - advisor.x)).toBeGreaterThanOrEqual(0.06)
    }
  })

  it('keeps each working member typing at its own desk when the style works seated', () => {
    const world = createTeamSceneWorld()
    const keys = ['NETSA-121', 'NETSA-222', 'NETSA-80']
    applyTeamSceneInput(
      world,
      input(keys.map((k) => member(k, { site: { stage: 1, broken: false } }))),
      { rowSize: 5, workSeated: true }
    )
    const homes = keys.map((k) => world.bodies.get(k)!.home.x)
    expect(new Set(homes).size).toBe(3)
    let strayed = false
    runUntil(
      world,
      () => {
        for (const k of keys) {
          const a = actor(world, k)!
          strayed ||= a.x !== world.bodies.get(k)!.home.x || a.pose !== 'work'
        }
        return false
      },
      20
    )
    expect(strayed).toBe(false)
  })

  it('still fetches between strikes where the style builds on the ground', () => {
    const world = seated(['a'])
    expect(runUntil(world, () => actor(world, 'a')?.pose === 'walk', 10)).toBe(true)
  })

  it('acts out each member state at its seat', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(
      world,
      input([
        member('w'),
        member('r', { activity: 'resting' }),
        member('q', { activity: 'needsYou' }),
        member('d', { activity: 'done' })
      ])
    )
    stepTeamScene(world, DT, { width: WIDTH })
    expect(actor(world, 'w')).toMatchObject({ pose: 'work', emote: null })
    expect(actor(world, 'r')).toMatchObject({ pose: 'idle', emote: null })
    expect(actor(world, 'q')).toMatchObject({ pose: 'raise', emote: 'alert' })
    expect(actor(world, 'd')).toMatchObject({ pose: 'done', emote: 'check' })
  })

  it('walks a new member straight to its desk and greets it there', () => {
    const world = seated(['a'])
    drainTeamSceneEffects(world)
    applyTeamSceneInput(world, input([member('a'), member('n')]))
    expect(actor(world, 'n')?.x).toBeLessThan(0)
    expect(runUntil(world, () => actor(world, 'n')?.pose === 'walk')).toBe(true)
    expect(runUntil(world, () => world.bodies.get('n')?.plan.kind === 'seated', 8)).toBe(true)
    expect(actor(world, 'n')?.pose).toBe('work')
    expect(actor(world, 'n')?.emote).toBe('heart')
    expect(drainTeamSceneEffects(world)).toContainEqual({
      kind: 'burst',
      key: 'n',
      reason: 'welcome'
    })
  })

  it('seats a whole team that joins at once within about 3 s, one after another, never snapping', () => {
    const keys = ['a', 'b', 'c', 'd', 'e']
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([]), { rowSize: 5, workSeated: true, firstX: 0.16 })
    applyTeamSceneInput(world, input(keys.map((k) => member(k))), {
      rowSize: 5,
      workSeated: true,
      firstX: 0.16
    })
    const seatedAt = new Map<string, number>()
    const last = new Map(keys.map((k) => [k, world.bodies.get(k)!.x]))
    let fastest = 0
    for (let t = 0; t < 4; t += DT) {
      stepTeamScene(world, DT, { width: 420 })
      for (const k of keys) {
        const body = world.bodies.get(k)!
        fastest = Math.max(fastest, Math.abs(body.x - last.get(k)!) * 420)
        last.set(k, body.x)
        if (body.plan.kind === 'seated' && !seatedAt.has(k)) {
          seatedAt.set(k, t)
        }
      }
    }
    const times = keys.map((k) => seatedAt.get(k))
    expect(times.every((t) => t !== undefined && t < 3.3)).toBe(true)
    times.slice(1).forEach((t, i) => expect(t!).toBeGreaterThan(times[i]!))
    expect(fastest).toBeLessThan(9)
    expect(keys.every((k) => world.bodies.get(k)!.speed === undefined)).toBe(true)
  })

  it('says goodbye and walks off stage without waiting on the lead', () => {
    const world = seated(['a', 'b'])
    applyTeamSceneInput(world, input([member('b')]))
    expect(actor(world, 'a')?.emote).toBe('heart')
    expect(runUntil(world, () => actor(world, 'a') === undefined, 12)).toBe(true)
  })

  it('seats a relaunched team at its desks at once, never leaving the desks empty', () => {
    const world = createTeamSceneWorld()
    const layout = { rowSize: 5, workSeated: true }
    const names = ['NETSA-121', 'NETSA-222', 'NETSA-80']
    const team = (prefix: string) => names.map((n) => member(`${prefix}${n}`, { name: n }))
    applyTeamSceneInput(world, input(team('old-')), layout)
    runUntil(world, () => false, 3)
    applyTeamSceneInput(world, input([]), layout)
    runUntil(world, () => false, 2)
    applyTeamSceneInput(world, input(team('new-')), layout)
    const sat = () =>
      team('new-').every((m) => {
        const body = world.bodies.get(m.key)!
        return body.plan.kind === 'seated' && body.x === body.home.x
      })
    expect(runUntil(world, sat, 12)).toBe(true)
    expect(new Set(team('new-').map((m) => world.bodies.get(m.key)!.home.x)).size).toBe(3)
    expect([...world.bodies.keys()].filter((k) => k.startsWith('old-'))).toEqual([])
  })

  it('walks a finished member to the lead to celebrate, then back to its seat, never off stage', () => {
    const world = seated(['a', 'b'])
    drainTeamSceneEffects(world)
    applyTeamSceneInput(world, input([member('a', { activity: 'done' }), member('b')]))
    expect(actor(world, 'a')?.emote).toBe('check')
    let left = false
    const watch = (until: () => boolean) =>
      runUntil(world, () => {
        left ||= actor(world, 'a') === undefined
        return until()
      })
    expect(watch(() => actor(world, 'a')?.pose === 'walk')).toBe(true)
    expect(watch(() => actor(world, 'a')?.emote === 'heart')).toBe(true)
    expect(actor(world, 'a')?.pose).toBe('cheer')
    expect(actor(world, 'lead')?.pose).toBe('cheer')
    expect(drainTeamSceneEffects(world)).toContainEqual({
      kind: 'burst',
      key: 'a',
      reason: 'finish'
    })
    expect(watch(() => world.bodies.get('a')?.plan.kind === 'seated')).toBe(true)
    expect(actor(world, 'a')?.pose).toBe('done')
    expect(actor(world, 'a')?.x).toBeCloseTo(world.bodies.get('a')!.home.x, 2)
    expect(left).toBe(false)
  })

  it('carries a report filed with the finish to the lead in the same walk', () => {
    const world = seated(['a'])
    drainTeamSceneEffects(world)
    applyTeamSceneInput(world, input([member('a', { activity: 'done', reportId: 'r1' })]))
    expect(runUntil(world, () => actor(world, 'a')?.carrying === true)).toBe(true)
    expect(runUntil(world, () => actor(world, 'a')?.emote === 'heart')).toBe(true)
    const effects = drainTeamSceneEffects(world)
    expect(effects).toContainEqual({ kind: 'handoff', from: 'a', to: 'lead' })
    expect(effects).toContainEqual({ kind: 'burst', key: 'a', reason: 'finish' })
    expect(world.queue).toEqual([])
  })

  it('carries a report to the lead and hands it over', () => {
    const world = seated(['a'])
    drainTeamSceneEffects(world)
    applyTeamSceneInput(world, input([member('a', { reportId: 'r1' })]))
    expect(runUntil(world, () => actor(world, 'a')?.carrying === true)).toBe(true)
    expect(runUntil(world, () => actor(world, 'lead')?.pose === 'give')).toBe(true)
    expect(drainTeamSceneEffects(world)).toContainEqual({ kind: 'handoff', from: 'a', to: 'lead' })
    expect(runUntil(world, () => actor(world, 'a')?.pose === 'work')).toBe(true)
  })

  it('serializes visits so only one member stands at the lead', () => {
    const world = seated(['a', 'b'])
    applyTeamSceneInput(
      world,
      input([member('a', { reportId: 'x' }), member('b', { reportId: 'y' })])
    )
    let both = false
    runUntil(
      world,
      () => {
        both ||= actor(world, 'a')?.carrying === true && actor(world, 'b')?.carrying === true
        return false
      },
      12
    )
    expect(both).toBe(false)
  })

  it('cheers a merge for a moment, then goes back to work', () => {
    const world = seated(['a', 'b'])
    applyTeamSceneInput(world, input([member('a', { mergedPr: 7 }), member('b')]))
    stepTeamScene(world, DT, { width: WIDTH })
    expect(teamSceneActors(world).every((a) => a.pose === 'cheer')).toBe(true)
    expect(actor(world, 'a')?.emote).toBe('star')
    expect(runUntil(world, () => actor(world, 'b')?.pose === 'work', 4)).toBe(true)
  })

  it('advances the gait by the distance walked, so feet stay planted', () => {
    const world = seated(['a'])
    applyTeamSceneInput(world, input([member('a'), member('n')]))
    let last = actor(world, 'n')
    let walked = 0
    let gait = 0
    runUntil(world, () => {
      const now = actor(world, 'n')
      if (now && last && now.pose === 'walk') {
        walked += (Math.abs(now.x - last.x) * WIDTH) / now.stride
        gait += now.gait - last.gait
      }
      last = now
      return now?.emote === 'heart'
    })
    expect(walked).toBeGreaterThan(1)
    expect(gait / Math.PI).toBeCloseTo(walked, 0)
  })

  it('jumps straight to the end state under reduced motion', () => {
    const world = seated(['a'])
    applyTeamSceneInput(world, input([member('a'), member('n')]))
    settleTeamScene(world)
    expect(actor(world, 'n')?.pose).toBe('work')
    applyTeamSceneInput(world, input([member('n')]))
    settleTeamScene(world)
    expect(actor(world, 'a')).toBeUndefined()
  })

  describe('the advisor walk at a row of desks', () => {
    // The Office layout: a row of five, members at their desks, room at the row's left end.
    const layout = { rowSize: 5, workSeated: true, firstX: 0.16 }
    const names = ['q', 'b', 'c', 'd']
    // The owner's case: the lead attends the needs-you member Jev then judges.
    const team = (decisions?: { id: string; verdict: string; gesture: null }[]) =>
      names.map((k, i) =>
        member(k, i === 0 ? { activity: 'needsYou', ...(decisions ? { decisions } : {}) } : {})
      )
    const judged = () => {
      const world = createTeamSceneWorld()
      applyTeamSceneInput(world, input(team(), ''), layout)
      runUntil(world, () => world.rounds.stage === 'atMember', 15)
      applyTeamSceneInput(
        world,
        input(team([{ id: 'd1', verdict: 'deny', gesture: null }]), ''),
        layout
      )
      return world
    }
    const AISLE = 0.2
    const BODY = 0.05

    // Why both: the lead may already stand at the member, or set out with the advisor.
    const judgedAtOnce = () => {
      const world = createTeamSceneWorld()
      applyTeamSceneInput(world, input(team(), ''), layout)
      // A second in: the lead has set out for the asker when Jev's decision arrives.
      runUntil(world, () => false, 1)
      applyTeamSceneInput(
        world,
        input(team([{ id: 'd1', verdict: 'deny', gesture: null }]), ''),
        layout
      )
      return world
    }

    it('keeps one body width from a walking lead, and from any lead in its aisle', () => {
      let closest = Infinity
      for (const world of [judged(), judgedAtOnce()]) {
        runUntil(
          world,
          () => {
            const advisor = world.bodies.get('advisor')!
            const lead = world.bodies.get('lead')!
            const walking = world.advisorWalk.stage !== 'home'
            const shared = Math.abs(advisor.depth - lead.depth) < AISLE
            if (walking && (Math.abs(lead.v) > 3 || shared)) {
              closest = Math.min(closest, Math.abs(advisor.x - lead.x))
            }
            return false
          },
          20
        )
      }
      expect(closest).toBeGreaterThanOrEqual(BODY)
    })

    it("stands clear of the edge member's own mark beside its monitor", () => {
      const world = judged()
      expect(runUntil(world, () => Boolean(actor(world, 'advisor')?.gesture), 20)).toBe(true)
      const seat = world.bodies.get('q')!.home.x
      // The back view hangs a sitter's mark just left of its monitor, within 0.07 of its seat.
      expect(seat - world.bodies.get('advisor')!.x).toBeGreaterThanOrEqual(0.085)
      // And its whole body stays on the stage.
      expect(world.bodies.get('advisor')!.x).toBeGreaterThanOrEqual(0.035)
    })

    it('never gestures off the stage, even beside a desk at its very edge', () => {
      const world = createTeamSceneWorld()
      const edge = { rowSize: 5, workSeated: true }
      applyTeamSceneInput(world, input(team(), ''), edge)
      runUntil(world, () => world.rounds.stage === 'atMember', 15)
      applyTeamSceneInput(
        world,
        input(team([{ id: 'd1', verdict: 'deny', gesture: null }]), ''),
        edge
      )
      expect(runUntil(world, () => Boolean(actor(world, 'advisor')?.gesture), 20)).toBe(true)
      expect(world.bodies.get('advisor')!.x).toBeGreaterThanOrEqual(0.035)
    })

    it('walks behind the row and steps in front only into the gap at the judged member', () => {
      const world = judged()
      const row = world.stations[0]!.depth
      const seats = world.stations.map((s) => s.x)
      const gap = seats[1]! - seats[0]!
      let overMonitor = false
      let gestured = false
      runUntil(
        world,
        () => {
          const advisor = world.bodies.get('advisor')!
          gestured ||= Boolean(actor(world, 'advisor')?.gesture)
          if (advisor.depth > row - AISLE) {
            // In front of the row, it stands only between two seats, never over one.
            overMonitor ||= seats.some((s) => Math.abs(advisor.x - s) < gap / 2 - 0.02)
          }
          return false
        },
        20
      )
      expect(gestured).toBe(true)
      expect(overMonitor).toBe(false)
    })

    it('never waits on a lead parked at the judged member: it gestures within 3 s of reaching it', () => {
      const world = judged()
      let reached: number | null = null
      let played: number | null = null
      runUntil(
        world,
        () => {
          const advisor = world.bodies.get('advisor')!
          const lead = world.bodies.get('lead')!
          // The lead stays on the asker the whole time: its question never closes here.
          expect(world.rounds.stage).toBe('atMember')
          if (reached === null && Math.abs(advisor.x - lead.x) < 2 * BODY) {
            reached = world.t
          }
          if (played === null && actor(world, 'advisor')?.gesture) {
            played = world.t
          }
          return played !== null
        },
        30
      )
      expect(reached).not.toBeNull()
      expect(played).not.toBeNull()
      expect(played! - reached!).toBeLessThanOrEqual(3)
    })

    it('puffs home at the end of its hold instead of walking back', () => {
      const world = judged()
      const home = world.bodies.get('advisor')!.home
      expect(runUntil(world, () => Boolean(actor(world, 'advisor')?.gesture), 20)).toBe(true)
      drainTeamSceneEffects(world)
      expect(runUntil(world, () => !actor(world, 'advisor')?.gesture, 3)).toBe(true)
      const advisor = world.bodies.get('advisor')!
      expect([advisor.x, advisor.depth]).toEqual([home.x, home.depth])
      const puffs = drainTeamSceneEffects(world).filter(
        (e) => e.kind === 'burst' && e.key === 'advisor' && e.reason === 'puff'
      )
      expect(puffs.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('walks the advisor to the member Jev judged, gestures there, then back', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a'), member('b')], ''))
    const home = actor(world, 'advisor')!.x
    const decided = [{ id: 'd1', verdict: 'deny', gesture: null }]
    applyTeamSceneInput(world, input([member('a'), member('b', { decisions: decided })], ''))
    expect(runUntil(world, () => actor(world, 'advisor')?.gesture === 'escalated', 15)).toBe(true)
    const b = world.bodies.get('b')!.home
    expect(Math.abs(actor(world, 'advisor')!.x - b.x)).toBeLessThan(0.1)
    expect(actor(world, 'advisor')?.pose).toBe('raise')
    // The judged member keeps its own round: the advisor's walk is no visit of its.
    expect(world.bodies.get('b')!.plan.kind).toBe('seated')
    expect(
      runUntil(
        world,
        () => {
          const a = actor(world, 'advisor')!
          return a.x === home && !a.gesture
        },
        20
      )
    ).toBe(true)
  })

  it('stands on the other side from the lead when both are at the same member', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('q', { activity: 'needsYou' })], ''))
    expect(runUntil(world, () => world.rounds.stage === 'atMember', 15)).toBe(true)
    const decided = [{ id: 'd1', verdict: 'deny', gesture: null }]
    applyTeamSceneInput(
      world,
      input([member('q', { activity: 'needsYou', decisions: decided })], '')
    )
    expect(runUntil(world, () => actor(world, 'advisor')?.gesture === 'escalated', 15)).toBe(true)
    const q = world.bodies.get('q')!.x
    const side = (key: string) => Math.sign(actor(world, key)!.x - q)
    expect(side('advisor')).toBe(-side('lead'))
  })

  it('gestures at the lead from its own spot when Jev judged the lead', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a')], ''))
    const judgedLead = {
      ...input([member('a')], ''),
      lead: { ...lead, decisions: [{ id: 'l1', verdict: 'ask', gesture: null }] }
    }
    applyTeamSceneInput(world, judgedLead)
    expect(runUntil(world, () => actor(world, 'advisor')?.gesture === 'unsure', 10)).toBe(true)
  })

  it('drops a judgment whose member left before the advisor got there', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([member('a'), member('b')], ''))
    const decided = [{ id: 'd1', verdict: 'deny', gesture: null }]
    applyTeamSceneInput(world, input([member('a'), member('b', { decisions: decided })], ''))
    applyTeamSceneInput(world, input([member('a')], ''))
    let gestured = false
    runUntil(
      world,
      () => {
        gestured ||= Boolean(actor(world, 'advisor')?.gesture)
        return false
      },
      15
    )
    expect(gestured).toBe(false)
  })

  it('shows the advisor line for six seconds after it speaks', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([], 'first'))
    expect(advisorLineShown(world)).toBeNull()
    applyTeamSceneInput(world, input([], 'Raised effort'))
    expect(actor(world, 'advisor')?.role).toBe('advisor')
    runUntil(world, () => false, 5.9)
    expect(advisorLineShown(world)).toBe('Raised effort')
    runUntil(world, () => false, 0.2)
    expect(advisorLineShown(world)).toBeNull()
  })

  it("times the advisor's line on real seconds when a slow frame's step is capped", () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, input([], 'first'))
    applyTeamSceneInput(world, input([], 'Raised effort'))
    // 3.5 frames a second: each 0.286 s frame moves the scene only 0.05 s.
    for (let frame = 0; frame < 20; frame++) {
      stepTeamScene(world, 0.05, { width: WIDTH, elapsed: 0.286 })
    }
    expect(advisorLineShown(world)).toBe('Raised effort')
    stepTeamScene(world, 0.05, { width: WIDTH, elapsed: 0.286 })
    expect(advisorLineShown(world)).toBeNull()
  })
})

describe('team scene director on a floor of the building', () => {
  const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16 }

  it('runs a floor with no lead: nobody walks to a lead who is not there', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(world, { ...input([member('a')]), leadless: true }, OFFICE)
    applyTeamSceneInput(
      world,
      { ...input([member('a', { reportId: 'r1', activity: 'done' })]), leadless: true },
      OFFICE
    )
    for (let t = 0; t < 10; t += DT) {
      stepTeamScene(world, DT, { width: 420 })
    }
    expect(actor(world, 'lead')).toBeUndefined()
    expect(world.bodies.get('a')?.plan.kind).toBe('seated')
  })

  it('adds empty desks after the members, the taken ones marked, and none by default', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(
      world,
      { ...input([member('a'), member('b')]), desks: { taken: 1, free: 2 } },
      OFFICE
    )
    expect(world.stations).toHaveLength(5)
    expect(world.stations.map((s) => s.taken === true)).toEqual([false, false, true, false, false])
    expect(world.sites.map((s) => s.key)).toEqual(['a', 'b'])
    const plain = createTeamSceneWorld()
    applyTeamSceneInput(plain, input([member('a'), member('b')]), OFFICE)
    expect(plain.stations).toHaveLength(2)
  })
})

describe('team scene director, the lead on a narrow building floor', () => {
  const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16 }
  const roams = (width: number, leadStays: boolean) => {
    const world = createTeamSceneWorld()
    const members = [member('a'), member('b'), member('c'), member('d')]
    applyTeamSceneInput(
      world,
      { ...input(members), ...(leadStays ? { leadStays: true } : {}) },
      OFFICE
    )
    const home = world.bodies.get('lead')!.x
    let farthest = 0
    for (let t = 0; t < 20; t += DT) {
      stepTeamScene(world, DT, { width })
      farthest = Math.max(farthest, Math.abs(world.bodies.get('lead')!.x - home))
    }
    return farthest
  }

  it('keeps the lead at its own spot on a narrow floor, so it never stands over a member', () => {
    expect(roams(320, true)).toBe(0)
  })

  it('still walks its rounds where there is room, or where the floor does not ask', () => {
    expect(roams(420, true)).toBeGreaterThan(0.05)
    expect(roams(320, false)).toBeGreaterThan(0.05)
  })
})

describe('team scene director, the lead riding between floors', () => {
  const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16 }
  const run = (world: TeamSceneWorld, seconds: number, width = 420) => {
    for (let t = 0; t < seconds; t += DT) {
      stepTeamScene(world, DT, { width })
    }
  }

  it('walks the lead into the elevator and off its floor, and back home when the ride ends', () => {
    const world = createTeamSceneWorld()
    const floor = input([member('a')])
    applyTeamSceneInput(world, floor, OFFICE)
    applyTeamSceneInput(world, { ...floor, ride: 'away' }, OFFICE)
    run(world, 8)
    expect(actor(world, 'lead')).toBeUndefined()
    applyTeamSceneInput(world, floor, OFFICE)
    run(world, 1 / 30)
    // Back out of the elevator, then onto the stage to its rounds.
    expect(actor(world, 'lead')!.x).toBeGreaterThan(1)
    run(world, 6)
    expect(actor(world, 'lead')!.x).toBeLessThan(1)
  })

  it('brings the lead out of the elevator to the member it visits on another floor, and away again', () => {
    const world = createTeamSceneWorld()
    const floor = {
      ...input([member('a'), member('b', { activity: 'needsYou' })]),
      leadless: true as const
    }
    applyTeamSceneInput(world, floor, OFFICE)
    expect(actor(world, 'lead')).toBeUndefined()
    applyTeamSceneInput(world, { ...floor, ride: { guest: 'b' } }, OFFICE)
    run(world, 14)
    const lead = actor(world, 'lead')!
    const b = world.bodies.get('b')!
    expect(Math.abs(lead.x - b.home.x)).toBeLessThan(0.1)
    applyTeamSceneInput(world, floor, OFFICE)
    run(world, 14)
    expect(actor(world, 'lead')).toBeUndefined()
  })

  // Why at 195: a floor of the building on the default Team panel is that wide (ORCA-1150 probe).
  it.each([195, 320])(
    'rides at %i px too: the lead leaves, and its guest stands in front of the member',
    (width) => {
      const home = createTeamSceneWorld()
      const floor = { ...input([member('a')]), leadStays: true as const }
      applyTeamSceneInput(home, { ...floor, ride: 'away' }, OFFICE)
      run(home, 20, width)
      expect(actor(home, 'lead')).toBeUndefined()
      const away = createTeamSceneWorld()
      const there = { ...input([member('b', { activity: 'needsYou' })]), leadless: true as const }
      applyTeamSceneInput(away, { ...there, ride: { guest: 'b' } }, OFFICE)
      run(away, 20, width)
      const guest = actor(away, 'lead')!
      const b = away.bodies.get('b')!
      // In front of the member, never on top of it.
      expect(guest.depth).toBeGreaterThan(b.home.depth + 0.1)
      expect(Math.abs(guest.x - b.home.x)).toBeLessThan(0.1)
    }
  )

  it("stands on its member's right, clear of the needs-you mark left of the monitor", () => {
    for (const keys of [
      ['b', 'c'],
      ['c', 'b']
    ]) {
      const away = createTeamSceneWorld()
      const there = {
        ...input(keys.map((k) => member(k, k === 'b' ? { activity: 'needsYou' } : {}))),
        leadless: true as const
      }
      applyTeamSceneInput(away, { ...there, ride: { guest: 'b' } }, OFFICE)
      run(away, 20, 195)
      expect(actor(away, 'lead')!.x, keys.join()).toBeGreaterThan(away.bodies.get('b')!.home.x)
    }
  })

  it('places a ride at once under reduced motion: the guest beside its member, the away lead gone', () => {
    const there = createTeamSceneWorld()
    const floor = {
      ...input([member('a'), member('b', { activity: 'needsYou' })]),
      leadless: true as const
    }
    applyTeamSceneInput(there, { ...floor, ride: { guest: 'b' } }, OFFICE)
    settleTeamScene(there)
    expect(Math.abs(actor(there, 'lead')!.x - there.bodies.get('b')!.home.x)).toBeLessThan(0.1)
    const home = createTeamSceneWorld()
    applyTeamSceneInput(home, { ...input([member('a')]), ride: 'away' }, OFFICE)
    settleTeamScene(home)
    expect(actor(home, 'lead')).toBeUndefined()
  })
})

describe('team scene director, a ride under reduced motion as the canvas paints it', () => {
  const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16 }
  // Why a zero step: the canvas settles, then paints, and painting steps the scene by no time.
  const painted = (world: TeamSceneWorld, width: number): void => {
    settleTeamScene(world)
    stepTeamScene(world, 0, { width })
  }
  const floors = () => {
    const home = createTeamSceneWorld()
    applyTeamSceneInput(home, { ...input([member('a')]), leadStays: true, ride: 'away' }, OFFICE)
    const there = createTeamSceneWorld()
    const floor = { ...input([member('b', { activity: 'needsYou' })]), leadless: true as const }
    applyTeamSceneInput(there, { ...floor, ride: { guest: 'b' } }, OFFICE)
    return { home, there }
  }

  it('shows the end of the ride where there is room', () => {
    const { home, there } = floors()
    painted(home, 420)
    painted(there, 420)
    expect(actor(home, 'lead')).toBeUndefined()
    expect(Math.abs(actor(there, 'lead')!.x - there.bodies.get('b')!.home.x)).toBeLessThan(0.1)
  })

  it('shows the end of the ride on the default panel too', () => {
    const { home, there } = floors()
    painted(home, 195)
    painted(there, 195)
    expect(actor(home, 'lead')).toBeUndefined()
    expect(actor(there, 'lead')!.depth).toBeGreaterThan(there.bodies.get('b')!.home.depth + 0.1)
  })
})

describe('team scene director, the advisor riding in', () => {
  it('brings the advisor in at the elevator on a floor it rides to', () => {
    const world = createTeamSceneWorld()
    applyTeamSceneInput(
      world,
      { ...input([member('a')], 'ok'), leadless: true, advisorEnters: true },
      {
        rowSize: 5,
        workSeated: true,
        firstX: 0.16
      }
    )
    expect(world.bodies.get('advisor')!.x).toBeGreaterThan(1)
  })
})

describe('team scene director, riders boarding the elevator', () => {
  const OFFICE = { rowSize: 5, workSeated: true, firstX: 0.16 }
  const run = (world: TeamSceneWorld, seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      stepTeamScene(world, DT, { width: 320 })
    }
  }

  it('says the lead boarded once it reaches the elevator, not before', () => {
    const world = createTeamSceneWorld()
    const floor = { ...input([member('a')]), leadStays: true as const }
    applyTeamSceneInput(world, floor, OFFICE)
    applyTeamSceneInput(world, { ...floor, ride: 'away' }, OFFICE)
    run(world, 0.2)
    expect(drainTeamSceneBoarded(world)).toEqual([])
    run(world, 10)
    expect(drainTeamSceneBoarded(world)).toEqual(['lead'])
    run(world, 2)
    expect(drainTeamSceneBoarded(world)).toEqual([])
  })

  it('walks a leaving advisor into the elevator, says it boarded, and takes it off the floor', () => {
    const world = createTeamSceneWorld()
    const floor = input([member('a')], 'ok')
    applyTeamSceneInput(world, floor, OFFICE)
    applyTeamSceneInput(world, { ...floor, advisorLeaves: true }, OFFICE)
    run(world, 0.2)
    expect(actor(world, 'advisor')).toBeDefined()
    run(world, 12)
    expect(actor(world, 'advisor')).toBeUndefined()
    expect(drainTeamSceneBoarded(world)).toEqual(['advisor'])
  })

  it('boards at once under reduced motion', () => {
    const world = createTeamSceneWorld()
    const floor = { ...input([member('a')], 'ok'), leadStays: true as const }
    applyTeamSceneInput(world, { ...floor, ride: 'away', advisorLeaves: true }, OFFICE)
    settleTeamScene(world)
    expect(drainTeamSceneBoarded(world).sort()).toEqual(['advisor', 'lead'])
  })
})
