import { describe, expect, it } from 'vitest'
import {
  dioramaCuePhase,
  dioramaCuesLive,
  dioramaCuesOf,
  dioramaIslandCuesOf
} from './team-diorama-cues'
import type { DioramaIsland } from './team-diorama-layout'

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
