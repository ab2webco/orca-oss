import { describe, expect, it, vi } from 'vitest'
import type { WorktreeLineage } from '../../shared/worktree/lineage-types'
import { OrcaRuntimeService } from './orca-runtime'

type Row = { id: string; repoId: string; instanceId?: string }

const LEAD = 'repo::/lead'
const MEMBER = 'repo::/member'
const OLD_LEAD = 'repo::/old-lead'
const CONTEXT = { taskId: 'task_1', runId: 'run_1', coordinatorHandle: 'term_lead' }

function lineageOf(parent: Row, child: Row, origin: WorktreeLineage['origin']): WorktreeLineage {
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

function runtimeWith(rows: Row[], stored: Record<string, WorktreeLineage> = {}) {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]))
  const metaById: Record<string, { instanceId?: string }> = {}
  const store = {
    getWorktreeLineage: (id: string) => stored[id],
    setWorktreeLineage: vi.fn((id: string, lineage: WorktreeLineage) => {
      stored[id] = lineage
      return lineage
    }),
    setWorkspaceLineage: vi.fn((lineage: unknown) => lineage),
    setWorktreeMeta: vi.fn((id: string) => {
      metaById[id] = { instanceId: metaById[id]?.instanceId ?? `minted-${id}` }
      return metaById[id]
    })
  }
  const runtime = new OrcaRuntimeService(store as never)
  // Why private spies: the selector and change push need a real repo scan and a window.
  const internals = runtime as unknown as {
    resolveWorktreeSelector: (selector: string) => Promise<Row>
    notifyWorktreesChanged: (repoId: string) => void
  }
  vi.spyOn(internals, 'resolveWorktreeSelector').mockImplementation(async (selector) => {
    const row = byId.get(selector.replace(/^id:/, ''))
    if (!row) {
      throw new Error('selector_not_found')
    }
    return row
  })
  vi.spyOn(internals, 'notifyWorktreesChanged').mockImplementation(() => {})
  return { runtime, store, stored }
}

describe('nestGameMemberWorktree (ORCA-1116)', () => {
  const lead = { id: LEAD, repoId: 'repo', instanceId: 'lead-i' }
  const member = { id: MEMBER, repoId: 'repo', instanceId: 'member-i' }
  const oldLead = { id: OLD_LEAD, repoId: 'repo', instanceId: 'old-i' }

  it('nests a member relaunched into an existing worktree that has no edge', async () => {
    const { runtime, stored } = runtimeWith([lead, member])

    await expect(runtime.nestGameMemberWorktree(MEMBER, LEAD, CONTEXT)).resolves.toBeNull()

    expect(stored[MEMBER]).toMatchObject({
      worktreeId: MEMBER,
      worktreeInstanceId: 'member-i',
      parentWorktreeId: LEAD,
      parentWorktreeInstanceId: 'lead-i',
      origin: 'orchestration',
      taskId: 'task_1',
      orchestrationRunId: 'run_1'
    })
  })

  it('mints the instance id a lead with no meta row lacks, instead of dropping the edge', async () => {
    const { runtime, stored, store } = runtimeWith([{ id: LEAD, repoId: 'repo' }, member])

    await expect(runtime.nestGameMemberWorktree(MEMBER, LEAD, CONTEXT)).resolves.toBeNull()

    expect(store.setWorktreeMeta).toHaveBeenCalledWith(LEAD, {})
    expect(stored[MEMBER]).toMatchObject({
      parentWorktreeId: LEAD,
      parentWorktreeInstanceId: `minted-${LEAD}`
    })
  })

  it('moves a member from a previous lead to the lead that launched it now', async () => {
    const { runtime, stored } = runtimeWith([lead, member, oldLead], {
      [MEMBER]: lineageOf(oldLead, member, 'orchestration')
    })

    await runtime.nestGameMemberWorktree(MEMBER, LEAD, CONTEXT)

    expect(stored[MEMBER].parentWorktreeId).toBe(LEAD)
  })

  it('replaces an edge whose instance went stale after its worktree was recreated', async () => {
    const { runtime, stored } = runtimeWith([lead, member], {
      [MEMBER]: { ...lineageOf(lead, member, 'orchestration'), worktreeInstanceId: 'gone' }
    })

    await runtime.nestGameMemberWorktree(MEMBER, LEAD, CONTEXT)

    expect(stored[MEMBER].worktreeInstanceId).toBe('member-i')
  })

  it('keeps a parent the person set by hand', async () => {
    const { runtime, store } = runtimeWith([lead, member, oldLead], {
      [MEMBER]: lineageOf(oldLead, member, 'manual')
    })

    await expect(runtime.nestGameMemberWorktree(MEMBER, LEAD, CONTEXT)).resolves.toBeNull()
    expect(store.setWorktreeLineage).not.toHaveBeenCalled()
  })

  it('leaves an edge already under the lead alone', async () => {
    const { runtime, store } = runtimeWith([lead, member], {
      [MEMBER]: lineageOf(lead, member, 'orchestration')
    })

    await runtime.nestGameMemberWorktree(MEMBER, LEAD, CONTEXT)

    expect(store.setWorktreeLineage).not.toHaveBeenCalled()
  })

  it('returns why a member in another repo cannot nest, and writes nothing', async () => {
    const other = { id: 'other::/member', repoId: 'other', instanceId: 'o-i' }
    const { runtime, store } = runtimeWith([lead, other])

    await expect(runtime.nestGameMemberWorktree(other.id, LEAD, CONTEXT)).resolves.toMatch(
      /same repository/
    )
    expect(store.setWorktreeLineage).not.toHaveBeenCalled()
  })

  it('does nothing for a member running in the lead worktree itself', async () => {
    const { runtime, store } = runtimeWith([lead])

    await expect(runtime.nestGameMemberWorktree(LEAD, LEAD, CONTEXT)).resolves.toBeNull()
    expect(store.setWorktreeLineage).not.toHaveBeenCalled()
  })
})
