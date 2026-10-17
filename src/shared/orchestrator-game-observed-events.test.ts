import { describe, expect, it } from 'vitest'
import { observedGameEventsOf } from './orchestrator-game-observed-events'
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
