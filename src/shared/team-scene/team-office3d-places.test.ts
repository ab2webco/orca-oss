import { describe, expect, it } from 'vitest'
import type { TeamSceneMemberInput } from './team-scene-types'
import { office3dPlaceOf } from './team-office3d-places'

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

// One row per line of the ORCA-1317 table (owner's corrections (a) and (b), 2026-11-21).
describe('where a 3D Office member belongs', () => {
  it('a working member is always at its desk, whatever else is true', () => {
    expect(office3dPlaceOf(m({ activity: 'working' }))).toBe('desk')
    expect(office3dPlaceOf(m({ activity: 'working', ci: 'pending' }))).toBe('desk')
    expect(office3dPlaceOf(m({ activity: 'working', hold: 'limited' }))).toBe('desk')
  })

  it("goes to the lead's office only with a question, a decision gate or a block", () => {
    expect(office3dPlaceOf(m({ activity: 'needsYou' }))).toBe('office')
    expect(office3dPlaceOf(m({ activity: 'blocked' }))).toBe('office')
    // A prompt in its own pane is answered at its own desk.
    expect(office3dPlaceOf(m({ activity: 'needsYou', paneAsk: true }))).toBe('desk')
  })

  it('stays at its desk with red CI, starting, logged out or unreachable', () => {
    expect(office3dPlaceOf(m({ activity: 'done', ci: 'failure' }))).toBe('desk')
    for (const hold of ['starting', 'loggedOut', 'unreachable'] as const) {
      expect(office3dPlaceOf(m({ hold }))).toBe('desk')
    }
  })

  it('waits in the cafeteria when finished with its PR still open, or out of quota', () => {
    expect(office3dPlaceOf(m({ activity: 'done', ci: 'pending' }))).toBe('cafe')
    expect(office3dPlaceOf(m({ activity: 'done', ci: 'success' }))).toBe('cafe')
    expect(
      office3dPlaceOf(m({ activity: 'done', desk: { kind: 'review', verdict: 'waiting' } }))
    ).toBe('cafe')
    expect(office3dPlaceOf(m({ activity: 'done', desk: { kind: 'queue', position: 2 } }))).toBe(
      'cafe'
    )
    expect(office3dPlaceOf(m({ hold: 'limited' }))).toBe('cafe')
    expect(office3dPlaceOf(m({ hold: 'asleep' }))).toBe('cafe')
  })

  it('plays in the games room when it has finished and nothing is open', () => {
    expect(office3dPlaceOf(m({ activity: 'resting' }))).toBe('games')
    expect(office3dPlaceOf(m({ activity: 'done' }))).toBe('games')
    expect(office3dPlaceOf(m({ activity: 'done', mergedPr: 12 }))).toBe('games')
  })

  it('is not in the building while its session is gone or waits for a slot', () => {
    expect(office3dPlaceOf(m({ away: true }))).toBe('gone')
    expect(office3dPlaceOf(m({ hold: 'queued' }))).toBe('gone')
  })
})
