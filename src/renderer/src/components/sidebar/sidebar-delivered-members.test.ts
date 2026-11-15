import { describe, expect, it } from 'vitest'
import type { GameHistoryRecord } from '../../../../shared/orchestrator-game-history'
import {
  DELIVERED_FOLD_AFTER_MS,
  alsoWorkedOn,
  deliveredMembersOf,
  deliveredPrKindOf,
  deliveredPrOf,
  groupDeliveredRows,
  type DeliveredMember
} from './sidebar-delivered-members'

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0)
const HOUR = 3_600_000

function record(overrides: Partial<GameHistoryRecord> = {}): GameHistoryRecord {
  return {
    ticket: 'ORCA-1203',
    repo: 'orca',
    branch: 'orca-1203',
    agent: 'claude',
    account: null,
    launchedAt: null,
    endedAt: new Date(NOW - 2 * HOUR).toISOString(),
    outcome: 'merged',
    pr: '#1208 merged',
    lastReport: null,
    character: 'Peach',
    worktreeId: 'wt-1203',
    leadWorktreeId: 'wt-lead',
    ...overrides
  }
}

const tree = [
  { id: 'wt-lead', branch: 'main', parentWorktreeId: null },
  { id: 'wt-1203', branch: 'orca-1203', parentWorktreeId: 'wt-lead' },
  { id: 'wt-live', branch: 'orca-1199', parentWorktreeId: 'wt-lead' },
  { id: 'wt-old', branch: 'refs/heads/orca-1170', parentWorktreeId: 'wt-lead' },
  { id: 'wt-elsewhere', branch: 'orca-1300', parentWorktreeId: null }
]

describe('deliveredMembersOf', () => {
  it("names a freed member's worktree by its latest record, with when it was freed", () => {
    const older = record({ endedAt: new Date(NOW - 30 * HOUR).toISOString(), pr: null })
    const delivered = deliveredMembersOf({
      records: [older, record()],
      leadWorktreeId: 'wt-lead',
      liveWorktreeIds: new Set(['wt-live']),
      worktrees: tree
    })

    expect(Object.keys(delivered)).toEqual(['wt-1203'])
    expect(delivered['wt-1203']).toEqual({
      worktreeId: 'wt-1203',
      ticket: 'ORCA-1203',
      branch: 'orca-1203',
      character: 'Peach',
      freedAt: NOW - 2 * HOUR,
      recordedPr: { number: 1208, state: 'merged' }
    })
  })

  it('keeps a live member live, even with a record from an earlier free', () => {
    const delivered = deliveredMembersOf({
      records: [record({ worktreeId: 'wt-live', ticket: 'ORCA-1199' })],
      leadWorktreeId: 'wt-lead',
      liveWorktreeIds: new Set(['wt-live']),
      worktrees: tree
    })

    expect(delivered).toEqual({})
  })

  it("matches an older host's record by branch only for a worktree nested under the lead", () => {
    const legacy = { ...record({ ticket: 'ORCA-1170', branch: 'refs/heads/orca-1170' }) }
    delete legacy.worktreeId
    delete legacy.leadWorktreeId
    const stray = { ...record({ ticket: 'ORCA-1300', branch: 'orca-1300' }) }
    delete stray.worktreeId
    delete stray.leadWorktreeId

    const delivered = deliveredMembersOf({
      records: [legacy, stray],
      leadWorktreeId: 'wt-lead',
      liveWorktreeIds: new Set(),
      worktrees: tree
    })

    expect(Object.keys(delivered)).toEqual(['wt-old'])
  })

  it('ignores a record another lead wrote, and a worktree that no longer exists', () => {
    const delivered = deliveredMembersOf({
      records: [record({ leadWorktreeId: 'wt-other-lead' }), record({ worktreeId: 'wt-gone' })],
      leadWorktreeId: 'wt-lead',
      liveWorktreeIds: new Set(),
      worktrees: tree
    })

    expect(delivered).toEqual({})
  })

  it('reads the ticket from the branch when the record carries none', () => {
    const delivered = deliveredMembersOf({
      records: [record({ ticket: null })],
      leadWorktreeId: 'wt-lead',
      liveWorktreeIds: new Set(),
      worktrees: tree
    })

    expect(delivered['wt-1203']?.ticket).toBe('ORCA-1203')
  })
})

describe('deliveredPrOf and deliveredPrKindOf', () => {
  const recordedPr = { number: 1205, state: 'open' as const }

  it("prefers the card's own review read over the PR recorded at the free", () => {
    const pr = deliveredPrOf(
      { number: 1205, title: 'Fix', state: 'open', status: 'failure' },
      recordedPr,
      new Set()
    )
    expect(pr).toEqual({ number: 1205, title: 'Fix', state: 'open', ci: 'failure', queued: false })
    expect(deliveredPrKindOf(pr)).toBe('ciFailing')
  })

  it('falls back to the recorded PR while the review is not read yet', () => {
    const pr = deliveredPrOf({ number: 1205, title: 'Loading PR...' }, recordedPr, new Set())
    expect(pr).toEqual({ number: 1205, title: null, state: 'open', ci: null, queued: false })
    expect(deliveredPrKindOf(pr)).toBe('open')
  })

  it('says queued only when the lead lists the PR in its merge queue', () => {
    const pr = deliveredPrOf(
      { number: 1206, title: 'Queue', state: 'open', status: 'pending' },
      null,
      new Set([1206])
    )
    expect(pr?.queued).toBe(true)
    expect(deliveredPrKindOf(pr)).toBe('open')
  })

  it('reads merged, closed and no PR', () => {
    expect(deliveredPrKindOf(deliveredPrOf(null, { number: 1, state: 'merged' }, new Set()))).toBe(
      'merged'
    )
    expect(deliveredPrKindOf(deliveredPrOf(null, { number: 1, state: 'closed' }, new Set()))).toBe(
      'closed'
    )
    expect(deliveredPrKindOf(deliveredPrOf(null, null, new Set()))).toBe('none')
  })
})

describe('groupDeliveredRows', () => {
  const row = (worktreeId: string, hoursAgo: number): DeliveredMember => ({
    worktreeId,
    ticket: worktreeId,
    branch: null,
    character: null,
    freedAt: NOW - hoursAgo * HOUR,
    recordedPr: null
  })

  it('lists the newest delivery first and folds rows freed more than 24 h ago', () => {
    const grouped = groupDeliveredRows(
      [row('old-merged', 30), row('new-merged', 2), row('open', 0.5), row('older-merged', 50)],
      () => 'merged',
      NOW
    )

    expect(grouped.recent.map((one) => one.worktreeId)).toEqual(['open', 'new-merged'])
    expect(grouped.folded.map((one) => one.worktreeId)).toEqual(['old-merged', 'older-merged'])
  })

  it('never folds a CI failure, however old', () => {
    const grouped = groupDeliveredRows(
      [row('failing', 40), row('merged', 30)],
      (id) => (id === 'failing' ? 'ciFailing' : 'merged'),
      NOW
    )

    expect(grouped.recent.map((one) => one.worktreeId)).toEqual(['failing'])
    expect(grouped.folded.map((one) => one.worktreeId)).toEqual(['merged'])
  })

  it('folds at exactly the fixed 24 h, not the activity window setting', () => {
    expect(DELIVERED_FOLD_AFTER_MS).toBe(24 * HOUR)
    const grouped = groupDeliveredRows(
      [row('edge', 24), row('just-past', 24.01)],
      () => 'open',
      NOW
    )
    expect(grouped.recent.map((one) => one.worktreeId)).toEqual(['edge'])
  })
})

describe('alsoWorkedOn', () => {
  it("lists the character's other tickets, newest first, with live ones in progress", () => {
    const others = alsoWorkedOn({
      character: 'Peach',
      ticket: 'ORCA-1203',
      records: [
        record({ ticket: 'ORCA-1149', pr: '#1150 merged', endedAt: '2026-11-10T00:00:00.000Z' }),
        record(),
        record({ ticket: 'ORCA-1100', character: 'Luigi' }),
        record({ ticket: 'ORCA-1180', pr: null, outcome: 'stopped' })
      ],
      liveMembers: [
        { name: 'Peach', ticket: 'ORCA-1216' },
        { name: 'Luigi', ticket: 'ORCA-1199' }
      ]
    })

    expect(others).toEqual([
      { ticket: 'ORCA-1180', kind: 'freed' },
      { ticket: 'ORCA-1149', kind: 'merged' },
      { ticket: 'ORCA-1216', kind: 'inProgress' }
    ])
  })

  it('has nothing to say without a character', () => {
    expect(
      alsoWorkedOn({ character: null, ticket: 'ORCA-1203', records: [record()], liveMembers: [] })
    ).toEqual([])
  })
})
