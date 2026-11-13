import { describe, expect, it } from 'vitest'
import { observedGameEventsOf, observedMergesOf } from './orchestrator-game-observed-events'
import type { GameAgent } from './orchestrator-game-state'

const member = (overrides: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'CIN-1 Cartelera',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...overrides
})

const review = (state: 'open' | 'merged', number = 41) => ({
  provider: 'github' as const,
  number,
  title: 'x',
  url: 'https://github.com/o/r/pull/41',
  state,
  ci: 'success' as const
})

const workItem = (statusGroup: 'review' | 'in_progress') => ({
  provider: 'jira' as const,
  identifier: 'CIN-1',
  title: 'Cartelera',
  url: 'https://jira/CIN-1',
  status: statusGroup === 'review' ? 'QA' : 'In Progress',
  statusGroup
})

describe('observedGameEventsOf', () => {
  it('sees a merged PR and a ticket in QA, each keyed so it is posted once', () => {
    expect(
      observedGameEventsOf([
        member({ review: review('merged'), workItem: workItem('review') }),
        member({ displayName: 'CIN-2 Seats', review: review('open', 42) }),
        { ...member({ review: review('merged') }), isLeader: true }
      ])
    ).toEqual([
      { kind: 'merged', ticket: 'CIN-1', text: 'PR #41 merged', key: 'merged CIN-1 #41' },
      { kind: 'qa_handoff', ticket: 'CIN-1', text: 'ticket QA', key: 'qa_handoff CIN-1 #41' }
    ])
  })

  it('needs a ticket to post anything', () => {
    expect(
      observedGameEventsOf([member({ displayName: 'Seats', review: review('merged') })])
    ).toEqual([])
  })

  it('keys a QA handoff without a PR on the ticket alone', () => {
    expect(observedGameEventsOf([member({ workItem: workItem('review') })])).toEqual([
      { kind: 'qa_handoff', ticket: 'CIN-1', text: 'ticket QA', key: 'qa_handoff CIN-1 -' }
    ])
  })
})

describe('observedMergesOf', () => {
  const worktree = { id: 'wt-1', branch: 'feat/cin-1', displayName: 'cin-1' }

  it("records a member's merged review under the merged event's key, with the host's decision", () => {
    expect(
      observedMergesOf([
        member({ worktree, review: { ...review('merged'), perfectMerge: true } }),
        member({ displayName: 'CIN-2 Seats', worktree, review: review('merged', 42) })
      ])
    ).toEqual([
      {
        kind: 'merged',
        ticket: 'CIN-1',
        text: 'PR #41 merged',
        key: 'merged CIN-1 #41',
        merge: { provider: 'github', number: 41, worktreeId: 'wt-1', perfect: true }
      },
      {
        kind: 'merged',
        ticket: 'CIN-2',
        text: 'PR #42 merged',
        key: 'merged CIN-2 #42',
        merge: { provider: 'github', number: 42, worktreeId: 'wt-1', perfect: false }
      }
    ])
  })

  it('needs a merged review, a ticket and a worktree of its own', () => {
    expect(
      observedMergesOf([
        member({ worktree, review: review('open') }),
        member({
          displayName: 'Seats',
          worktree: { id: 'wt-2', branch: 'feat/seats', displayName: 'seats' },
          review: review('merged')
        }),
        member({ review: review('merged') }),
        { ...member({ worktree, review: review('merged') }), isLeader: true }
      ])
    ).toEqual([])
  })

  // Why (ORCA-1170): auto-release frees a merged member with no record, so the merge must name who earned it.
  it("names the merged member's character under its roster key", () => {
    const roster = [{ en: 'Arthur', es: 'Arturo' }]
    const [named] = observedMergesOf(
      [member({ displayName: 'Arturo · CIN-1 Cartelera', worktree, review: review('merged') })],
      roster
    )
    const [unnamed] = observedMergesOf([member({ worktree, review: review('merged') })], roster)

    expect(named?.character).toEqual({ key: 'arthur', name: 'Arturo' })
    expect(unnamed).not.toHaveProperty('character')
  })

  it('records nothing for a found session, which earns its lead nothing (ORCA-914)', () => {
    expect(
      observedMergesOf([
        member({ worktree, found: true, review: { ...review('merged'), perfectMerge: true } })
      ])
    ).toEqual([])
  })
})
