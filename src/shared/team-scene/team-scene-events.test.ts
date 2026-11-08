import { describe, expect, it } from 'vitest'
import { teamSceneEventsBetween } from './team-scene-events'
import type { TeamSceneInput, TeamSceneMemberInput } from './team-scene-types'

const lead = { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' } as const
const member = (key: string, extra: Partial<TeamSceneMemberInput> = {}): TeamSceneMemberInput => ({
  key,
  name: key,
  characterKey: null,
  activity: 'working',
  reportId: null,
  mergedPr: null,
  ...extra
})
const input = (members: TeamSceneMemberInput[], advisorLine?: string | null): TeamSceneInput => ({
  lead,
  advisor: advisorLine === undefined ? null : { line: advisorLine },
  members
})

describe('teamSceneEventsBetween', () => {
  it('reports nothing on the first snapshot, so an open panel does not replay history', () => {
    expect(teamSceneEventsBetween(null, input([member('a', { mergedPr: 9 })], 'hi'))).toEqual([])
  })

  it('welcomes a new member and says goodbye to one that left', () => {
    const events = teamSceneEventsBetween(input([member('a')]), input([member('b')]))
    expect(events).toEqual([
      { kind: 'leave', key: 'a' },
      { kind: 'join', key: 'b' }
    ])
  })

  it('hands work to the lead when a member files a new report', () => {
    const prev = input([member('a', { reportId: 'r1' })])
    expect(teamSceneEventsBetween(prev, input([member('a', { reportId: 'r2' })]))).toEqual([
      { kind: 'handoff', key: 'a' }
    ])
    expect(teamSceneEventsBetween(prev, input([member('a', { reportId: null })]))).toEqual([])
  })

  it('celebrates a merge once per pull request', () => {
    const prev = input([member('a')])
    const next = input([member('a', { mergedPr: 12 })])
    expect(teamSceneEventsBetween(prev, next)).toEqual([{ kind: 'merge', key: 'a' }])
    expect(teamSceneEventsBetween(next, next)).toEqual([])
  })

  it('lets the advisor speak only when its line changes', () => {
    expect(teamSceneEventsBetween(input([], 'a'), input([], 'b'))).toEqual([
      { kind: 'advisorSpoke', line: 'b' }
    ])
    expect(teamSceneEventsBetween(input([], 'a'), input([], null))).toEqual([])
    expect(teamSceneEventsBetween(input([]), input([], 'a'))).toEqual([
      { kind: 'advisorSpoke', line: 'a' }
    ])
  })
})
