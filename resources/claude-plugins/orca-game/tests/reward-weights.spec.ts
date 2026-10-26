import { describe, expect, it } from 'vitest'

import type { GameAgent, GameReview, GameState, GameWorkItem } from '../types'
import { earnedRewardsOf } from '../hooks/fleet-rewards'
import { parseGameState } from '../hooks/game-state'
import { awardXp, levelOf, signedXpOf, xpLedgerOf } from '../hooks/rewards'

const review = (patch: Partial<GameReview> = {}): GameReview => ({
  provider: 'github',
  number: 41,
  title: 'feat: x',
  url: 'https://github.com/o/r/pull/41',
  state: 'open',
  ci: 'pending',
  ...patch
})

const workItem = (patch: Partial<GameWorkItem> = {}): GameWorkItem => ({
  provider: 'plane',
  identifier: 'ORCA-12',
  title: 'x',
  url: 'https://plane.example/ORCA-12',
  status: 'In Progress',
  statusGroup: 'in_progress',
  ...patch
})

const member = (patch: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: 'p-12',
  displayName: 'ORCA-12',
  agentType: 'claude',
  state: 'working',
  toolName: 'Edit',
  isLeader: false,
  isMember: true,
  worktree: { id: 'wt-12', branch: 'feat/orca-12', displayName: 'orca-12' },
  review: review(),
  workItem: workItem(),
  ...patch
})

const state = (patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: { id: 'wt-main', path: '/w', branch: 'main', displayName: 'main' },
  agents: [],
  review: review(),
  workItem: workItem(),
  role: 'lead',
  ...patch
})

const kindsAndXp = (rewards: { kind: string; xp: number }[]) =>
  rewards.map(({ kind, xp }) => [kind, xp])

describe('Reward weights from the project', () => {
  it('awards the baseline with no weights, as a host older than them sends', () => {
    const earned = earnedRewardsOf(
      state(),
      state({ review: review({ ci: 'success' }), workItem: workItem({ statusGroup: 'done' }) })
    )

    expect(kindsAndXp(earned)).toEqual([
      ['ci-green', 20],
      ['work-item-done', 70]
    ])
  })

  it("uses the next state's weights, lowering one and writing nothing for one set to 0", () => {
    const weights = { 'ci-green': 5, 'work-item-done': 0, 'member-claimed': 3 }
    const earned = earnedRewardsOf(
      state(),
      state({
        review: review({ ci: 'success' }),
        workItem: workItem({ statusGroup: 'done' }),
        agents: [member()],
        rewardWeights: weights
      })
    )

    expect(kindsAndXp(earned)).toEqual([
      ['ci-green', 5],
      ['member-claimed', 3]
    ])
  })

  it("weights a member's review and ticket the same way for its lead", () => {
    const before = state({ review: null, workItem: null, agents: [member()] })
    const after = state({
      review: null,
      workItem: null,
      agents: [member({ review: review({ state: 'merged' }) })],
      rewardWeights: { 'review-merged': 150 }
    })

    expect(kindsAndXp(earnedRewardsOf(before, after))).toEqual([['review-merged', 150]])
  })

  it('keeps a stored row at its xp after the weight changes', () => {
    const first = awardXp(
      xpLedgerOf(undefined),
      earnedRewardsOf(state(), state({ review: review({ ci: 'success' }) })),
      1
    )
    const again = awardXp(
      first.ledger,
      earnedRewardsOf(
        state(),
        state({ review: review({ ci: 'success' }), rewardWeights: { 'ci-green': 90 } })
      ),
      2
    )

    expect(again.awarded).toEqual([])
    expect(again.ledger.total).toBe(20)
  })
})

describe('Reward weights on the wire', () => {
  it('keeps the known whole-number weights and drops the rest', () => {
    const parsed = parseGameState(
      JSON.stringify({
        rewardWeights: {
          'ci-green': 5,
          'member-claimed': 0,
          'work-item-done': -1,
          'review-merged': 2.5,
          'pr-opened': 9
        }
      })
    )

    expect(parsed?.rewardWeights).toEqual({ 'ci-green': 5, 'member-claimed': 0 })
    expect(parseGameState('{}')?.rewardWeights).toBeUndefined()
  })
})

describe('A row that takes XP away', () => {
  it('lowers the total, keeps the level at 1 or more, and reads with its sign', () => {
    const { ledger } = awardXp(
      xpLedgerOf({ awards: { 'ci-green:a': { xp: 20, at: 1 } } }),
      [{ id: 'loss:a', kind: 'ci-green', xp: -50, label: 'x' }],
      2
    )

    expect(ledger.total).toBe(-30)
    expect(levelOf(ledger.total)).toEqual({ level: 1, into: 0, need: 100 })
    expect(signedXpOf(-30)).toBe('-30')
    expect(signedXpOf(20)).toBe('+20')
  })
})

describe('The perfect-merge weight', () => {
  it('is read from the wire like any other reward', () => {
    const parsed = parseGameState(JSON.stringify({ rewardWeights: { 'perfect-merge': 40 } }))

    expect(parsed?.rewardWeights).toEqual({ 'perfect-merge': 40 })
  })
})
