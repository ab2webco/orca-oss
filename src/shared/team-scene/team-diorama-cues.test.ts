import { describe, expect, it } from 'vitest'
import {
  dioramaAskerOf,
  dioramaAttendCueOf,
  dioramaCuePhase,
  dioramaCuesLive,
  dioramaCuesOf,
  dioramaIslandCuesOf,
  type DioramaCue
} from './team-diorama-cues'
import { teamDioramaLayoutOf, type DioramaIsland, type DioramaMachine } from './team-diorama-layout'
import type { TeamSceneActivity, TeamSceneInput } from './team-scene-types'

describe('the diorama cues', () => {
  it('turns the team moments into what the diorama plays', () => {
    const cues = dioramaCuesOf(
      [
        { kind: 'join', key: 'a' },
        { kind: 'merge', key: 'b' },
        { kind: 'ciGreen', key: 'c' },
        { kind: 'judged', key: 'lead', gesture: 'approved', tone: 'allow' },
        { kind: 'leave', key: 'd' }
      ],
      100
    )
    expect(cues.map((c) => `${c.kind}:${c.key}:${c.tone}`)).toEqual([
      'arrive:a:note',
      'confetti:b:allow',
      'flash:c:allow',
      'talk:advisor:allow',
      'bird:lead:allow'
    ])
    // The bird leaves once the advisor has lowered its spyglass.
    expect(cues[4]!.start).toBeGreaterThan(cues[3]!.start)
  })

  it('keeps a moment playing across reads until it ends, one per kind and member', () => {
    const first = dioramaCuesOf([{ kind: 'merge', key: 'b' }], 100)
    const kept = dioramaCuesLive([], first, 100)
    expect(dioramaCuesLive(kept, [], 102)).toHaveLength(1)
    expect(dioramaCuesLive(kept, [], 105)).toHaveLength(0)
    const again = dioramaCuesOf([{ kind: 'merge', key: 'b' }], 103)
    const both = dioramaCuesLive(kept, again, 103)
    expect(both).toHaveLength(1)
    expect(both[0]!.start).toBe(103)
  })

  it('reads a cue as before, during and after by its phase', () => {
    const [c] = dioramaCuesOf([{ kind: 'ciGreen', key: 'c' }], 10)
    expect(dioramaCuePhase(c!, 9)).toBeLessThan(0)
    expect(dioramaCuePhase(c!, 11)).toBeGreaterThan(0)
    expect(dioramaCuePhase(c!, 11)).toBeLessThan(1)
    expect(dioramaCuePhase(c!, 20)).toBeGreaterThan(1)
  })
})

describe('the cues of a newly connected machine', () => {
  const island = (key: string, home: boolean, members: string[]) =>
    ({
      key,
      name: key,
      home,
      reachable: true,
      rect: { x: 0, z: 0, hw: 3, hd: 3 },
      plots: members.map((m) => ({ x: 0, z: 0, key: m, taken: false })),
      dock: null,
      column: 0
    }) as DioramaIsland

  it('raises nothing on the first read, so opening the panel replays nothing', () => {
    expect(
      dioramaIslandCuesOf(null, [island('', true, []), island('m2', false, ['a'])], 5)
    ).toEqual([])
  })

  it('raises a new island and has its members step out once it stands', () => {
    const cues = dioramaIslandCuesOf(
      [''],
      [island('', true, ['h']), island('m2', false, ['a', 'b'])],
      5
    )
    expect(cues.map((c) => `${c.kind}:${c.key}`)).toEqual(['rise:m2', 'arrive:a', 'arrive:b'])
    expect(cues[1]!.start).toBeGreaterThan(cues[0]!.start + 2)
  })

  it('leaves machines it already drew where they are', () => {
    expect(
      dioramaIslandCuesOf(['', 'm2'], [island('', true, []), island('m2', false, ['a'])], 5)
    ).toEqual([])
  })
})

// ORCA-1336: the lead sets out only for a member who asks, and stays until it is answered.
describe("the lead's attend cue", () => {
  const machine = (key: string, members: string[], over: Partial<DioramaMachine> = {}) => ({
    key,
    name: key,
    home: key === '',
    reachable: true,
    members,
    cap: null,
    taken: 0,
    ...over
  })
  const layout = teamDioramaLayoutOf([
    machine('', ['a', 'b']),
    machine('m3', ['z'], { reachable: false })
  ])
  const team = (asking: string[], lead: TeamSceneActivity = 'working'): TeamSceneInput => ({
    lead: { key: 'lead', name: 'Lead', characterKey: null, activity: lead },
    advisor: null,
    members: ['a', 'b', 'z'].map((key) => ({
      key,
      name: key,
      characterKey: null,
      activity: asking.includes(key) ? 'needsYou' : 'working',
      reportId: null,
      mergedPr: null,
      site: { stage: 1, broken: false }
    }))
  })
  const trip = (c: DioramaCue | null) => (c ? `${c.from}>${c.key}@${c.start}` : null)

  it('has none while nobody asks, however much the members work', () => {
    expect(dioramaAttendCueOf(undefined, team([]), layout, 5)).toBeNull()
    expect(dioramaAskerOf(team([]), layout)).toBeNull()
  })

  it('sets out from the gate when a member asks, and keeps its start while it still asks', () => {
    const first = dioramaAttendCueOf(undefined, team(['b']), layout, 5)
    expect(trip(first)).toBe('>b@5')
    expect(first!.until).toBe(Infinity)
    expect(dioramaAttendCueOf(first!, team(['b']), layout, 9)).toBe(first)
  })

  it('goes on to the next asker from the one just answered, and home when none is left', () => {
    const atB = dioramaAttendCueOf(undefined, team(['b']), layout, 5)!
    const atA = dioramaAttendCueOf(atB, team(['a']), layout, 20)
    expect(trip(atA)).toBe('b>a@20')
    const home = dioramaAttendCueOf(atA!, team([]), layout, 30)
    expect(trip(home)).toBe('a>@30')
    expect(dioramaAttendCueOf(home!, team([]), layout, 40)).toBe(home)
  })

  it('never sets out to an unreachable machine, nor while the lead cannot work', () => {
    expect(dioramaAskerOf(team(['z']), layout)).toBeNull()
    expect(dioramaAttendCueOf(undefined, team(['b'], 'blocked'), layout, 5)).toBeNull()
  })
})
