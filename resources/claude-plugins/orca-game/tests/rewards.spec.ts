import { describe, expect, it } from 'vitest'

import type { GameReview, GameState, GameWorkItem } from '../types'
import { awardXp, isCiRed, levelOf, rewardsOf, xpLedgerOf } from '../hooks/rewards'

const review = (patch: Partial<GameReview> = {}): GameReview => ({
  provider: 'github',
  number: 7,
  title: 'feat: x',
  url: 'https://github.com/o/r/pull/7',
  state: 'open',
  ci: 'pending',
  ...patch
})

const workItem = (patch: Partial<GameWorkItem> = {}): GameWorkItem => ({
  provider: 'plane',
  identifier: 'ORCA-1',
  title: 'x',
  url: 'https://plane.example/ORCA-1',
  status: 'In Progress',
  statusGroup: 'in_progress',
  ...patch
})

const state = (patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  worktree: { id: 'wt-1', path: '/w', branch: 'b', displayName: 'w' },
  agents: [],
  review: null,
  workItem: null,
  ...patch
})

describe('rewardsOf', () => {
  it('rewards a review that merges, CI that turns green and a work item moving on', () => {
    const before = state({ review: review({ ci: 'failure' }), workItem: workItem() })
    const after = state({
      review: review({ ci: 'success', state: 'merged' }),
      workItem: workItem({ statusGroup: 'review' })
    })
    expect(rewardsOf(before, after).map((one) => [one.kind, one.xp])).toEqual([
      ['review-merged', 100],
      ['ci-green', 20],
      ['work-item-review', 50]
    ])
    const done = state({ workItem: workItem({ statusGroup: 'done' }) })
    expect(rewardsOf(after, done).map((one) => one.kind)).toEqual(['work-item-done'])
  })

  it('only rewards a change it saw happen', () => {
    const merged = state({ review: review({ state: 'merged', ci: 'success' }) })
    expect(rewardsOf(null, merged)).toEqual([])
    expect(rewardsOf(merged, merged)).toEqual([])
    const otherWorktree = state({
      worktree: { id: 'wt-2', path: '/v', branch: 'b', displayName: 'v' },
      review: review()
    })
    expect(rewardsOf(otherWorktree, merged)).toEqual([])
    expect(rewardsOf(state({ review: review({ number: 8 }) }), merged)).toEqual([])
  })
})

describe('xp ledger', () => {
  it('awards each reward once and survives a round trip through the store', () => {
    const rewards = rewardsOf(
      state({ review: review() }),
      state({ review: review({ state: 'merged', ci: 'success' }) })
    )
    const first = awardXp(xpLedgerOf(undefined), rewards, 1000)
    expect(first.ledger.total).toBe(120)
    expect(first.awarded).toHaveLength(2)
    const again = awardXp(first.ledger, rewards, 2000)
    expect(again.ledger).toEqual(first.ledger)
    expect(again.awarded).toEqual([])
    expect(xpLedgerOf(JSON.parse(JSON.stringify(first.ledger)))).toEqual(first.ledger)
  })

  it('reads a damaged ledger as empty entries', () => {
    expect(xpLedgerOf('nope')).toEqual({ total: 0, awards: {} })
    expect(xpLedgerOf({ awards: { a: { xp: 'lots', at: 1 }, b: { xp: 5, at: 2 } } })).toEqual({
      total: 5,
      awards: { b: { xp: 5, at: 2 } }
    })
  })

  it('climbs a level per 100 XP times the level', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 100 })
    expect(levelOf(130)).toEqual({ level: 2, into: 30, need: 200 })
    expect(levelOf(300)).toEqual({ level: 3, into: 0, need: 300 })
  })
})

describe('isCiRed', () => {
  it('is red only for a live review whose checks fail', () => {
    expect(isCiRed(review({ ci: 'failure' }))).toBe(true)
    expect(isCiRed(review({ ci: 'failure', state: 'draft' }))).toBe(true)
    expect(isCiRed(review({ ci: 'failure', state: 'merged' }))).toBe(false)
    expect(isCiRed(review({ ci: 'success' }))).toBe(false)
    expect(isCiRed(null)).toBe(false)
  })
})
