import { describe, expect, it } from 'vitest'
import type { TeamHost, TeamMemberCard } from '../team-panel-model-types'
import { office3dRideDur } from './team-office3d-elevator'
import { OFFICE3D_CALL_PANEL, teamOffice3dLayoutOf } from './team-office3d-layout'
import { office3dTraffic, office3dTrafficRead } from './team-office3d-traffic'
import { office3dWalkerAt } from './team-office3d-walkers'
import type { TeamSceneFloor } from './team-scene-floors'
import type { TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

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
const layout = teamOffice3dLayoutOf([floor('', ['a', 'b']), floor('m2', ['c'])], {
  leadAdvisor: false
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
const team = [member('a'), member('b'), member('c', { ci: 'pending' })]

/** Every second from `from` to `to`: whether the lead is in its chair at its desk. */
const seatedAt = (traffic: ReturnType<typeof office3dTraffic>, from: number, to: number) => {
  const out: boolean[] = []
  for (let t = from; t <= to; t += 0.5) {
    out.push(office3dWalkerAt(traffic.lead!, t).pose === 'desk')
  }
  return out
}

// The owner: nothing moves without a real event, and the lead stops pacing (ORCA-1317).
describe("the 3D Office lead's events", () => {
  it('sits at its desk for two minutes of reads with no change', () => {
    const traffic = office3dTraffic()
    for (let now = 0; now <= 120; now += 20) {
      office3dTrafficRead(traffic, layout, input(team), now, 'normal')
    }
    expect(seatedAt(traffic, 0, 140).every(Boolean)).toBe(true)
  })

  it('walks once to a member whose CI just went red, talks, and sits again; a repeated read adds nothing', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, layout, input(team), 0, 'normal')
    const red = input([member('a'), member('b'), member('c', { ci: 'failure', activity: 'done' })])
    office3dTrafficRead(traffic, layout, red, 20, 'normal')
    const steps = traffic.lead!.steps.length
    office3dTrafficRead(traffic, layout, red, 40, 'normal')
    expect(traffic.lead!.steps.length).toBe(steps)
    expect(seatedAt(traffic, 0, 19.5).every(Boolean)).toBe(true)
    const talks = traffic.lead!.steps.filter((s) => s.kind === 'hold' && s.pose === 'talk')
    expect(talks).toHaveLength(1)
    // To m2, the member's floor, and back: two rides.
    expect(traffic.lead!.steps.filter((s) => s.kind === 'ride')).toHaveLength(2)
    expect(office3dWalkerAt(traffic.lead!, 200).pose).toBe('desk')
  })

  it('brings a folder to a member that just joined', () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, layout, input([member('a'), member('b')]), 0, 'normal')
    office3dTrafficRead(traffic, layout, input(team), 20, 'normal')
    expect(traffic.lead!.steps.filter((s) => s.kind === 'hold' && s.pose === 'give')).toHaveLength(
      1
    )
  })

  // ORCA-1336 C2, from the Mac recording: Ho joined on m2 and the lead stood ~9 s at the lift door.
  it('stays at its desk while a joiner rides up, then waits at the panel only for the cab', () => {
    const before = teamOffice3dLayoutOf([floor('', ['a', 'b']), floor('m2', ['c'])], {
      leadAdvisor: false
    })
    const after = teamOffice3dLayoutOf([floor('', ['a', 'b']), floor('m2', ['c', 'ho'])], {
      leadAdvisor: false
    })
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, before, input(team), 0, 'normal')
    office3dTrafficRead(traffic, after, input([...team, member('ho')]), 5, 'normal')
    const steps = traffic.lead!.steps
    const panel = steps.filter(
      (s) => s.kind === 'hold' && s.pose === 'idle' && s.face === OFFICE3D_CALL_PANEL
    )
    expect(panel.length).toBeGreaterThan(0)
    for (const s of panel) {
      expect(s.dur).toBeLessThanOrEqual(office3dRideDur(0, after.floors.length - 1) + 1e-6)
    }
    expect(steps.filter((s) => s.kind === 'hold' && s.pose === 'give')).toHaveLength(1)
  })

  it("stays seated for a member's question: the member comes to its office", () => {
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, layout, input(team), 0, 'normal')
    office3dTrafficRead(
      traffic,
      layout,
      input([member('a', { activity: 'needsYou' }), member('b'), member('c')]),
      20,
      'normal'
    )
    expect(seatedAt(traffic, 0, 60).every(Boolean)).toBe(true)
  })
})

// Review ORCA-1319, finding 3: two riders drew as one figure for the whole ride.
describe('riders in the cab', () => {
  it('keep their side-by-side spots for the whole ride, never closer than 0.4', () => {
    const shared = teamOffice3dLayoutOf([floor('', ['a']), floor('m2', ['c', 'd'])], {
      leadAdvisor: false
    })
    const busy = [member('a'), member('c'), member('d')]
    const traffic = office3dTraffic()
    office3dTrafficRead(traffic, shared, input(busy), 0, 'normal')
    const free = [
      member('a'),
      member('c', { activity: 'resting' }),
      member('d', { activity: 'resting' })
    ]
    office3dTrafficRead(traffic, shared, input(free), 1, 'normal')
    const riding = (key: string, t: number) => {
      const plan = traffic.members.get(key)!.plan
      return plan.steps.some((s) => s.kind === 'ride' && t >= s.start && t < s.start + s.dur)
    }
    let together = 0
    for (let t = 1; t < 60; t += 0.05) {
      if (!riding('c', t) || !riding('d', t)) {
        continue
      }
      together += 1
      const c = office3dWalkerAt(traffic.members.get('c')!.plan, t).at
      const d = office3dWalkerAt(traffic.members.get('d')!.plan, t).at
      expect(
        Math.hypot(c[0] - d[0], c[1] - d[1]),
        `riders met at ${t.toFixed(2)}`
      ).toBeGreaterThanOrEqual(0.4)
    }
    expect(together, 'c and d never shared a ride').toBeGreaterThan(0)
  })
})

describe('a member walking out of the 3D Office', () => {
  it('keeps the sheet of its persistent character after its card is gone, not its pane', () => {
    const traffic = office3dTraffic()
    const ada = member('a', { characterKey: 'char-ada' })
    office3dTrafficRead(traffic, layout, input([ada, member('b')]), 0, 'normal')
    office3dTrafficRead(traffic, layout, input([member('b')]), 5, 'normal')
    const leaver = traffic.members.get('a')!
    expect(leaver.leaving).toBe(true)
    expect(leaver.look).toBe('char-ada')
    expect(traffic.members.get('b')!.look).toBe('b')
  })
})
