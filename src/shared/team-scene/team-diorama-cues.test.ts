import { describe, expect, it } from 'vitest'
import { dioramaCuePhase, dioramaCuesLive, dioramaCuesOf } from './team-diorama-cues'

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
