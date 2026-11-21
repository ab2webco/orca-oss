import { describe, expect, it } from 'vitest'
import type { TeamSceneMemberInput } from './team-scene-types'
import { office3dPlaceOf, office3dWaitOf } from './team-office3d-places'

const m = (over: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key: 'a',
  name: 'a',
  characterKey: null,
  activity: 'resting',
  reportId: null,
  mergedPr: null,
  site: { stage: 1, broken: false },
  ...over
})
const at = (over: Partial<TeamSceneMemberInput>) => office3dPlaceOf(m(over), 'cafe')

// One row per line of the ORCA-1317 table, as the data check kept it (2026-11-21).
describe('where a 3D Office member belongs', () => {
  it('a working member is always at its desk, whatever else is true', () => {
    expect(at({ activity: 'working' })).toBe('desk')
    expect(at({ activity: 'working', ci: 'pending' })).toBe('desk')
    expect(at({ activity: 'working', ci: 'failure' })).toBe('desk')
  })

  it("goes to the lead's office only with an Inbox question or a decision gate", () => {
    expect(at({ activity: 'needsYou' })).toBe('office')
    // A prompt in its own pane is answered at its own desk.
    expect(at({ activity: 'needsYou', paneAsk: true })).toBe('desk')
    // The scene's can't-run catch-all is not a problem for the lead.
    expect(at({ activity: 'blocked' })).toBe('desk')
  })

  it('goes back to its desk with red CI, and stays there while it cannot run', () => {
    expect(at({ activity: 'done', ci: 'failure' })).toBe('desk')
    for (const hold of ['starting', 'loggedOut', 'unreachable'] as const) {
      expect(at({ activity: 'blocked', hold })).toBe('desk')
    }
  })

  it('waits for its quota in the cafeteria', () => {
    expect(at({ activity: 'blocked', hold: 'limited' })).toBe('cafe')
    expect(at({ activity: 'blocked', hold: 'asleep' })).toBe('cafe')
  })

  it('waits on an open PR where its pick for that wait says', () => {
    for (const wait of ['desk', 'cafe', 'games'] as const) {
      expect(office3dPlaceOf(m({ activity: 'done', ci: 'pending' }), wait)).toBe(wait)
      expect(office3dPlaceOf(m({ activity: 'done', ci: 'success' }), wait)).toBe(wait)
      expect(
        office3dPlaceOf(m({ activity: 'done', desk: { kind: 'queue', position: 1 } }), wait)
      ).toBe(wait)
    }
  })

  it('is available in the games room when merged or with nothing to do', () => {
    expect(at({ activity: 'resting' })).toBe('games')
    expect(at({ activity: 'done', mergedPr: 12 })).toBe('games')
  })

  it('is not in the building while its session is gone or waits for a slot', () => {
    expect(at({ away: true })).toBe('gone')
    expect(at({ hold: 'queued', activity: 'blocked' })).toBe('gone')
  })
})

describe('the pick for a wait', () => {
  it('holds for the same member and wait, and spreads a team over the three places', () => {
    expect(office3dWaitOf('a', 'pr-7#1')).toBe(office3dWaitOf('a', 'pr-7#1'))
    const picks = new Set(
      Array.from({ length: 12 }, (_, i) => office3dWaitOf(`member-${i}`, 'pr-1#1'))
    )
    expect(picks.size).toBe(3)
  })
})
