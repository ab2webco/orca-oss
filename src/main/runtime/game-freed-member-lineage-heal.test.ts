import { describe, expect, it, vi } from 'vitest'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'
import type { WorktreeLineage } from '../../shared/worktree/lineage-types'
import { OrcaRuntimeService } from './orca-runtime'

type Row = { id: string; repoId: string; instanceId?: string }

const LEAD = 'repo::/lead'
const MEMBER = 'repo::/member'
const OTHER = 'repo::/other'
const lead: Row = { id: LEAD, repoId: 'repo', instanceId: 'lead-i' }
const member: Row = { id: MEMBER, repoId: 'repo', instanceId: 'member-i' }
const other: Row = { id: OTHER, repoId: 'repo', instanceId: 'other-i' }

function freed(overrides: Partial<GameHistoryRecord> = {}): GameHistoryRecord {
  return {
    ticket: 'ORCA-1203',
    repo: 'orca-oss',
    branch: 'orca-1203',
    agent: 'claude',
    account: null,
    launchedAt: null,
    endedAt: new Date(Date.now() - 60_000).toISOString(),
    outcome: 'qa',
    pr: '#1208 open',
    lastReport: null,
    worktreeId: MEMBER,
    leadWorktreeId: LEAD,
    ...overrides
  }
}

function edge(parent: Row, child: Row, origin: WorktreeLineage['origin']): WorktreeLineage {
  return {
    worktreeId: child.id,
    worktreeInstanceId: child.instanceId!,
    parentWorktreeId: parent.id,
    parentWorktreeInstanceId: parent.instanceId!,
    origin,
    capture: { source: 'manual-action', confidence: 'explicit' },
    createdAt: 1
  }
}

function runtimeWith(
  rows: Row[],
  records: GameHistoryRecord[],
  stored: Record<string, WorktreeLineage> = {}
) {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]))
  const store = {
    getWorktreeLineage: (id: string) => stored[id],
    setWorktreeLineage: vi.fn((id: string, lineage: WorktreeLineage) => {
      stored[id] = lineage
      return lineage
    }),
    setWorkspaceLineage: vi.fn((lineage: unknown) => lineage),
    setWorktreeMeta: vi.fn(() => ({})),
    getRepo: () => undefined
  }
  const runtime = new OrcaRuntimeService(store as never)
  const internals = runtime as unknown as {
    resolveWorktreeSelector: (selector: string) => Promise<Row>
    notifyWorktreesChanged: (repoId: string) => void
    gameHistory: { list: (projectKey: string) => Promise<GameHistoryRecord[]> }
  }
  vi.spyOn(internals, 'resolveWorktreeSelector').mockImplementation(async (selector) => {
    const row = byId.get(selector.replace(/^id:/, ''))
    if (!row) {
      throw new Error('selector_not_found')
    }
    return row
  })
  vi.spyOn(internals, 'notifyWorktreesChanged').mockImplementation(() => {})
  const list = vi.spyOn(internals.gameHistory, 'list').mockResolvedValue(records)
  return { runtime, store, stored, list }
}

describe('healFreedMemberLineage (ORCA-1216 §6)', () => {
  it('nests a freed member whose edge is gone under the lead its history names', async () => {
    const { runtime, stored, list } = runtimeWith([lead, member], [freed()])

    await runtime.healFreedMemberLineage([lead, member])

    expect(list).toHaveBeenCalledWith('repo:repo')
    expect(stored[MEMBER]).toMatchObject({
      parentWorktreeId: LEAD,
      worktreeInstanceId: 'member-i',
      parentWorktreeInstanceId: 'lead-i',
      origin: 'orchestration'
    })
  })

  it('replaces a freed member edge whose instance ids went stale', async () => {
    const { runtime, stored } = runtimeWith([lead, member], [freed()], {
      [MEMBER]: { ...edge(lead, member, 'orchestration'), parentWorktreeInstanceId: 'rotated' }
    })

    await runtime.healFreedMemberLineage([lead, member])

    expect(stored[MEMBER].parentWorktreeInstanceId).toBe('lead-i')
  })

  it('keeps a parent the person set by hand', async () => {
    const { runtime, store } = runtimeWith([lead, member, other], [freed()], {
      [MEMBER]: edge(other, member, 'manual')
    })

    await runtime.healFreedMemberLineage([lead, member, other])

    expect(store.setWorktreeLineage).not.toHaveBeenCalled()
  })

  it('records the member and lead worktrees when the lead frees a member', async () => {
    const { runtime } = runtimeWith([lead, member], [])
    const internals = runtime as unknown as {
      getResolvedWorktreeMap: () => Promise<Map<string, Row>>
      gameHistory: { append: (key: string, record: GameHistoryRecord) => Promise<unknown[]> }
    }
    vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
      new Map([lead, member].map((row) => [row.id, row]))
    )
    const append = vi.spyOn(internals.gameHistory, 'append').mockResolvedValue([])
    const { worktreeId: _w, leadWorktreeId: _l, ...sent } = freed()

    await runtime.recordGameHistory({ worktreeId: LEAD, memberWorktreeId: MEMBER, record: sent })

    expect(append.mock.calls[0]?.[1]).toMatchObject({ worktreeId: MEMBER, leadWorktreeId: LEAD })
  })

  it('reads each project history once per session', async () => {
    const { runtime, list } = runtimeWith([lead, member], [])

    await runtime.healFreedMemberLineage([lead, member])
    await runtime.healFreedMemberLineage([lead, member])

    expect(list).toHaveBeenCalledTimes(1)
  })
})
