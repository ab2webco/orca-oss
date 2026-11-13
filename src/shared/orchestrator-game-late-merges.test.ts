import { describe, expect, it } from 'vitest'
import { creditGameMerge, settleClosedReview } from './orchestrator-game-characters'
import type { GameHistoryRecord } from './orchestrator-game-history'
import { GAME_LATE_REVIEW_MAX, lateReviewChecksOf } from './orchestrator-game-late-merges'

const freed = (ticket: string, patch: Partial<GameHistoryRecord> = {}): GameHistoryRecord => ({
  ticket,
  repo: 'orca-wa-inbox',
  branch: `refs/heads/${ticket.toLowerCase()}`,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt: '2026-11-11T23:57:03.479Z',
  outcome: 'stopped',
  pr: '#98 open',
  lastReport: null,
  character: 'Merlín',
  ...patch
})

const keyOf = (name: string): string => (name === 'Merlín' ? 'merlin' : name.toLowerCase())
const merlin = { key: 'merlin', name: 'Merlín' }

// Why (ORCA-1170): a stopped member's PR merges later in the queue, with no member left to see it.
describe('lateReviewChecksOf', () => {
  it('lists the newest freed records whose PR was still open, with the character it would pay', () => {
    const records = [
      freed('WAINBOX-79'),
      freed('WAINBOX-80', { pr: '#99 draft', branch: 'feat/wainbox-80' }),
      freed('WAINBOX-81', { pr: '#100 merged' }),
      freed('WAINBOX-82', { pr: '#101 closed' }),
      freed('WAINBOX-83', { pr: null }),
      freed('WAINBOX-84', { character: null }),
      freed('WAINBOX-85', { branch: null })
    ]

    expect(lateReviewChecksOf(records, {}, keyOf)).toEqual([
      {
        ticket: 'WAINBOX-80',
        number: 99,
        branch: 'feat/wainbox-80',
        repo: 'orca-wa-inbox',
        character: merlin
      },
      {
        ticket: 'WAINBOX-79',
        number: 98,
        branch: 'refs/heads/wainbox-79',
        repo: 'orca-wa-inbox',
        character: merlin
      }
    ])
  })

  it('stops checking a PR once it was paid or closed, and checks one PR once', () => {
    const paid = creditGameMerge({}, merlin, { ticket: 'WAINBOX-79', number: 98, at: 'x' }) ?? {}
    const closed = settleClosedReview(paid, merlin, { ticket: 'WAINBOX-80', number: 99 })
    const records = [
      freed('WAINBOX-79'),
      freed('WAINBOX-80', { pr: '#99 open' }),
      freed('WAINBOX-81', { pr: '#100 open' }),
      freed('WAINBOX-81', { pr: '#100 open', endedAt: '2026-11-12T01:00:00.000Z' })
    ]

    expect(lateReviewChecksOf(records, closed, keyOf).map((one) => one.ticket)).toEqual([
      'WAINBOX-81'
    ])
  })

  it('checks at most the newest twenty', () => {
    const records = Array.from({ length: GAME_LATE_REVIEW_MAX + 5 }, (_, at) =>
      freed(`WAINBOX-${at}`, { pr: `#${at + 1} open` })
    )
    const checks = lateReviewChecksOf(records, {}, keyOf)

    expect(checks).toHaveLength(GAME_LATE_REVIEW_MAX)
    expect(checks[0]?.ticket).toBe(`WAINBOX-${GAME_LATE_REVIEW_MAX + 4}`)
  })
})
