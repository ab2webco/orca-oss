import { describe, expect, it } from 'vitest'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'
import { FREED_MEMBER_NEST_WINDOW_MS, freedMembersToNest } from './game-freed-member-lineage'

const NOW = Date.parse('2026-11-15T12:00:00Z')

function freed(overrides: Partial<GameHistoryRecord>): GameHistoryRecord {
  return {
    ticket: 'ORCA-1203',
    repo: 'orca-oss',
    branch: 'orca-1203',
    agent: 'claude',
    account: null,
    launchedAt: null,
    endedAt: new Date(NOW - 60_000).toISOString(),
    outcome: 'qa',
    pr: '#1208 open',
    lastReport: null,
    worktreeId: 'repo::/member',
    leadWorktreeId: 'repo::/lead',
    ...overrides
  }
}

const exists = (ids: string[]) => (id: string) => ids.includes(id)

describe('freedMembersToNest (ORCA-1216 §6)', () => {
  it('names each freed member whose worktree and lead still exist', () => {
    expect(freedMembersToNest([freed({})], NOW, exists(['repo::/member', 'repo::/lead']))).toEqual([
      { memberWorktreeId: 'repo::/member', leadWorktreeId: 'repo::/lead' }
    ])
  })

  it('skips a record from an older build, which names no worktree or lead', () => {
    const older = freed({})
    delete older.worktreeId
    delete older.leadWorktreeId
    expect(freedMembersToNest([older], NOW, () => true)).toEqual([])
  })

  it('skips a member whose worktree or lead is gone', () => {
    expect(freedMembersToNest([freed({})], NOW, exists(['repo::/lead']))).toEqual([])
    expect(freedMembersToNest([freed({})], NOW, exists(['repo::/member']))).toEqual([])
  })

  it('skips a member freed longer ago than the window', () => {
    const old = freed({ endedAt: new Date(NOW - FREED_MEMBER_NEST_WINDOW_MS - 1).toISOString() })
    expect(freedMembersToNest([old], NOW, () => true)).toEqual([])
  })

  it('follows the latest record when one worktree was freed twice', () => {
    const first = freed({ leadWorktreeId: 'repo::/old-lead', endedAt: '2026-11-15T10:00:00Z' })
    const second = freed({ endedAt: '2026-11-15T11:00:00Z' })
    expect(freedMembersToNest([first, second], NOW, () => true)).toEqual([
      { memberWorktreeId: 'repo::/member', leadWorktreeId: 'repo::/lead' }
    ])
  })

  it('skips a member detached from its lead by hand, whose latest record names no lead', () => {
    const detached = freed({ endedAt: '2026-11-15T11:00:00Z' })
    delete detached.leadWorktreeId
    expect(
      freedMembersToNest([freed({ endedAt: '2026-11-15T10:00:00Z' }), detached], NOW, () => true)
    ).toEqual([])
  })
})
