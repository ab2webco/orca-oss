import { describe, expect, it } from 'vitest'
import {
  GameMemberNameReservations,
  liveProjectMemberNamesOf
} from './orchestrator-game-member-name-reservations'

const row = (paneKey: string, parentPaneKey: string | null, displayName: string | null) => ({
  paneKey,
  parentPaneKey,
  displayName
})

const WORKTREES = [
  { worktreeId: 'wt-lead', repoId: 'repo-1', agents: [row('lead', null, null)] },
  { worktreeId: 'wt-1', repoId: 'repo-1', agents: [row('m1', 'lead', 'Arthur · ORCA-1 Home')] },
  { worktreeId: 'wt-2', repoId: 'repo-2', agents: [row('m2', 'lead', 'Merlin · ORCA-2 API')] },
  { worktreeId: 'wt-3', repoId: 'repo-1', agents: [row('m3', 'gone', 'Morgana · ORCA-3 Old')] },
  { worktreeId: 'wt-4', repoId: 'repo-9', agents: [row('m4', 'other', 'Gawain · OTH-1 Away')] },
  { worktreeId: 'wt-5', repoId: 'repo-1', agents: [] }
]
const inProject = (one: { repoId?: string }) => one.repoId === 'repo-1'

describe('liveProjectMemberNamesOf', () => {
  it("names every live member of the project: its repo's worktrees and its leads' members elsewhere", () => {
    expect(liveProjectMemberNamesOf({ worktrees: WORKTREES, inProject, saved: [] })).toEqual([
      'Arthur',
      'Merlin',
      'Morgana'
    ])
  })

  it('adds a saved, unfinished member whose worktree still runs an agent, but not a finished or gone one', () => {
    const saved = [
      { name: 'Percival · ORCA-7 Saved', worktreeId: 'wt-4', lastState: 'working' },
      { name: 'Tristan · ORCA-8 Done', worktreeId: 'wt-1', lastState: 'finished' },
      { name: 'Galahad · ORCA-9 Closed', worktreeId: 'wt-5', lastState: 'working' },
      { name: null, worktreeId: 'wt-1', lastState: 'working' }
    ]
    expect(liveProjectMemberNamesOf({ worktrees: [], inProject, saved })).toEqual([])
    expect(liveProjectMemberNamesOf({ worktrees: WORKTREES, inProject, saved }).slice(3)).toEqual([
      'Percival'
    ])
  })

  it('adds the names of members placed on paired hosts, so a local launch never takes one (ORCA-794)', () => {
    expect(
      liveProjectMemberNamesOf({
        worktrees: [],
        inProject,
        saved: [],
        remote: ['Lancelot · ORCA-5 Away', 'ORCA-6 unnamed']
      })
    ).toEqual(['Lancelot'])
  })
})

const ROSTER = [{ en: 'Arthur', es: 'Arturo' }, 'Merlin', 'Lancelot']

describe('GameMemberNameReservations', () => {
  const reserve = (
    names: GameMemberNameReservations,
    ticket: string,
    taken: string[] = [],
    projectKey = 'repo:repo-1'
  ) => names.reserve({ projectKey, ticket, roster: ROSTER, locale: 'en', taken })

  it('never hands one name to two launches, even before either member runs', () => {
    const names = new GameMemberNameReservations(() => 0)

    expect([reserve(names, 'A-1'), reserve(names, 'A-2'), reserve(names, 'A-3')]).toEqual([
      'Arthur',
      'Merlin',
      'Lancelot'
    ])
    expect([reserve(names, 'A-4'), reserve(names, 'A-5')]).toEqual(['Arthur 2', 'Merlin 2'])
  })

  it('skips taken names in any language, and keeps projects apart', () => {
    const names = new GameMemberNameReservations(() => 0)

    expect(reserve(names, 'A-1', ['arturo'])).toBe('Merlin')
    expect(reserve(names, 'B-1', [], 'repo:repo-2')).toBe('Arthur')
  })

  it('gives a relaunched ticket its own held name back, and frees a hold once it expires', () => {
    let now = 0
    const names = new GameMemberNameReservations(() => now)

    expect(reserve(names, 'A-1')).toBe('Arthur')
    expect(reserve(names, 'A-1')).toBe('Arthur')
    expect(reserve(names, 'A-2')).toBe('Merlin')
    now = 11 * 60_000
    expect(reserve(names, 'A-3')).toBe('Arthur')
  })
})
