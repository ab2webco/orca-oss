import { describe, expect, it } from 'vitest'

import type { GameAgent, GameMerge, GameReview, GameState, GameWorkItem } from '../types'
import { fleetRewardsOf } from '../hooks/fleet-rewards'
import { awardXp, rewardsOf, xpLedgerOf } from '../hooks/rewards'

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

const lead: GameAgent = {
  paneKey: 'lead',
  displayName: 'lead',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: true
}

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

const leadState = (members: GameAgent[], patch: Partial<GameState> = {}): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: { id: 'wt-main', path: '/w', branch: 'main', displayName: 'main' },
  agents: [lead, ...members],
  review: null,
  workItem: null,
  role: 'lead',
  ...patch
})

// What the member's own pane sees: its worktree, its review and its ticket.
const ownState = (agent: GameAgent): GameState => ({
  ...leadState([]),
  worktree: { id: 'wt-12', path: '/m', branch: 'feat/orca-12', displayName: 'orca-12' },
  review: agent.review ?? null,
  workItem: agent.workItem ?? null,
  role: 'member'
})

const kinds = (previous: GameState | null, next: GameState) =>
  fleetRewardsOf(previous, next).map((one) => [one.kind, one.xp])

describe('fleetRewardsOf', () => {
  it("rewards a member's CI going green, its PR merging and its ticket moving on", () => {
    const before = member({ review: review({ ci: 'failure' }) })
    const after = member({
      review: review({ ci: 'success', state: 'merged' }),
      workItem: workItem({ status: 'QA', statusGroup: 'review' })
    })
    expect(kinds(leadState([before]), leadState([after]))).toEqual([
      ['review-merged', 100],
      ['ci-green', 20],
      ['work-item-review', 50]
    ])
    const done = member({ ...after, workItem: workItem({ status: 'Done', statusGroup: 'done' }) })
    expect(kinds(leadState([after]), leadState([done]))).toEqual([['work-item-done', 70]])
  })

  it("keys each award exactly as the member's own pane does, so a shared ledger counts it once", () => {
    const before = member({ review: review({ ci: 'failure' }) })
    const after = member({
      review: review({ ci: 'success', state: 'merged' }),
      workItem: workItem({ statusGroup: 'done' })
    })
    const fleet = fleetRewardsOf(leadState([before]), leadState([after]))
    const own = rewardsOf(ownState(before), ownState(after))
    expect(fleet.map((one) => one.id)).toEqual(own.map((one) => one.id))
    const shared = awardXp(awardXp(xpLedgerOf(undefined), own, 1).ledger, fleet, 2)
    expect(shared.awarded).toEqual([])
    expect(shared.ledger.total).toBe(190)
  })

  it('rewards a member launched between two polls once, by its worktree', () => {
    const one = member({ review: undefined, workItem: undefined })
    expect(kinds(leadState([]), leadState([one]))).toEqual([['member-claimed', 10]])
    const id = fleetRewardsOf(leadState([]), leadState([one]))[0]?.id
    const relaunched = member({ ...one, paneKey: 'p-12-again' })
    expect(fleetRewardsOf(leadState([]), leadState([relaunched]))[0]?.id).toBe(id)
  })

  it('awards nothing on the first refresh, for a member leaving or for work already done', () => {
    const merged = member({ review: review({ state: 'merged', ci: 'success' }) })
    expect(fleetRewardsOf(null, leadState([merged]))).toEqual([])
    expect(fleetRewardsOf(leadState([merged]), leadState([merged]))).toEqual([])
    expect(fleetRewardsOf(leadState([member()]), leadState([]))).toEqual([])
    const otherLead = leadState([], {
      worktree: { id: 'wt-x', path: '/x', branch: 'main', displayName: 'x' }
    })
    expect(fleetRewardsOf(otherLead, leadState([merged]))).toEqual([])
    expect(
      fleetRewardsOf(leadState([member({ review: review({ number: 9 }) })]), leadState([merged]))
    ).toEqual([])
  })

  it("counts only the lead's launched members, never teammates or a member pane's siblings", () => {
    const teammate = member({ isMember: undefined, worktree: undefined, paneKey: 't' })
    const before = member({ review: review() })
    const after = member({ review: review({ state: 'merged' }) })
    expect(fleetRewardsOf(leadState([teammate]), leadState([teammate]))).toEqual([])
    expect(fleetRewardsOf(leadState([]), leadState([teammate]))).toEqual([])
    const asMember = { role: 'member' as const }
    expect(fleetRewardsOf(leadState([before], asMember), leadState([after], asMember))).toEqual([])
    expect(fleetRewardsOf(leadState([], asMember), leadState([after], asMember))).toEqual([])
  })

  it("names the member's ticket and review in its label", () => {
    const after = member({ review: review({ state: 'merged' }) })
    const [merged] = fleetRewardsOf(leadState([member()]), leadState([after]))
    expect(merged?.label).toBe('ORCA-12 · #41 merged')
    expect(merged?.review).toBe('#41')
  })
})

describe("A member's perfect merge", () => {
  it('earns its lead the perfect-merge reward when the merged PR turns perfect', () => {
    const merged = member({ review: review({ state: 'merged', ci: 'success' }) })
    const perfect = member({
      review: review({ state: 'merged', ci: 'success', perfectMerge: true })
    })

    expect(kinds(leadState([merged]), leadState([perfect]))).toEqual([['perfect-merge', 100]])
  })

  it("names the member's ticket like its merged toast", () => {
    const merged = member({ review: review({ state: 'merged', ci: 'success' }) })
    const perfect = member({
      review: review({ state: 'merged', ci: 'success', perfectMerge: true })
    })

    const [one] = fleetRewardsOf(leadState([merged]), leadState([perfect]))
    expect(one?.label).toBe('ORCA-12 · #41 perfect merge')
  })
})

// ORCA-887: the lead and auto-release free a member right after its merge, before a poll sees it.
describe("A member's merge Orca recorded after the member left", () => {
  const merge = (patch: Partial<GameMerge> = {}): GameMerge => ({
    key: 'merged ORCA-12 #41',
    ticket: 'ORCA-12',
    provider: 'github',
    number: 41,
    worktreeId: 'wt-12',
    perfect: true,
    ...patch
  })
  const open = member({ review: review({ ci: 'success' }) })

  it('earns the merge and the perfect merge under the ids a poll that saw it would use', () => {
    const rewards = fleetRewardsOf(
      leadState([open], { merges: [] }),
      leadState([], { merges: [merge()] })
    )
    expect(rewards.map((one) => [one.id, one.xp, one.label])).toEqual([
      ['review-merged:github#41@wt-12', 100, 'ORCA-12 · #41 merged'],
      ['perfect-merge:github#41@wt-12', 100, 'ORCA-12 · #41 perfect merge']
    ])
    const seen = fleetRewardsOf(
      leadState([open]),
      leadState([member({ review: review({ state: 'merged', perfectMerge: true }) })])
    )
    expect(seen.map((one) => one.id)).toEqual(rewards.map((one) => one.id))
  })

  it('earns only the merge for one the host did not call perfect', () => {
    expect(
      kinds(leadState([], { merges: [] }), leadState([], { merges: [merge({ perfect: false })] }))
    ).toEqual([['review-merged', 100]])
  })

  it('earns a merge once: not again on the next poll, nor when the member shows it too', () => {
    const recorded = leadState([], { merges: [merge()] })
    expect(fleetRewardsOf(recorded, recorded)).toEqual([])
    const both = leadState([member({ review: review({ state: 'merged', perfectMerge: true }) })], {
      merges: [merge()]
    })
    expect(kinds(leadState([open], { merges: [] }), both)).toEqual([
      ['review-merged', 100],
      ['perfect-merge', 100]
    ])
  })

  it('awards no recorded merge on the first poll, after an older host, or in a member pane', () => {
    const recorded = leadState([], { merges: [merge()] })
    expect(fleetRewardsOf(null, recorded)).toEqual([])
    expect(fleetRewardsOf(leadState([]), recorded)).toEqual([])
    const asMember = { role: 'member' as const }
    expect(
      fleetRewardsOf(
        leadState([], { ...asMember, merges: [] }),
        leadState([], { ...asMember, merges: [merge()] })
      )
    ).toEqual([])
  })
})
