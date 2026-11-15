import { describe, expect, it } from 'vitest'
import { breakDownWorktreesHiddenByFilters } from './sidebar-filter-hidden-count'
import {
  createSidebarHidingFilterResolver,
  type SidebarHidingFilter
} from './sidebar-hiding-filters'
import type { Worktree } from '../../../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'

function makeWorktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId: 'repo1',
    path: `/tmp/${id}`,
    head: 'abc123',
    branch: 'refs/heads/feature',
    isBare: false,
    isMainWorktree: false,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function byId(worktrees: Worktree[]): Map<string, Worktree> {
  return new Map(worktrees.map((worktree) => [worktree.id, worktree]))
}

function resolverFrom(
  filters: Record<string, SidebarHidingFilter>
): (worktree: Worktree) => SidebarHidingFilter | null {
  return (worktree) => filters[worktree.id] ?? null
}

describe('breakDownWorktreesHiddenByFilters', () => {
  it('counts each hidden row once, under its filter, in the documented order', () => {
    const worktrees = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makeWorktree(id))
    const breakdown = breakDownWorktreesHiddenByFilters(
      worktrees.map((worktree) => worktree.id),
      ['a'],
      byId(worktrees),
      resolverFrom({ b: 'sleeping', c: 'detached-head', d: 'cli', e: 'detached-head', f: 'cli' })
    )
    expect(breakdown.counts).toEqual([
      { filter: 'cli', count: 2 },
      { filter: 'detached-head', count: 2 },
      { filter: 'sleeping', count: 1 }
    ])
    expect(breakdown.total).toBe(5)
    expect(breakdown.counts.reduce((sum, entry) => sum + entry.count, 0)).toBe(breakdown.total)
    expect(breakdown.hiddenIds).toEqual(['b', 'c', 'd', 'e', 'f'])
  })

  it('is empty when every sorted worktree is visible', () => {
    const worktrees = [makeWorktree('a'), makeWorktree('b')]
    const breakdown = breakDownWorktreesHiddenByFilters(
      ['a', 'b'],
      ['b', 'a'],
      byId(worktrees),
      resolverFrom({ a: 'cli' })
    )
    expect(breakdown).toEqual({ total: 0, counts: [], hiddenIds: [] })
  })

  it('ignores visible ids that are not in the sorted list', () => {
    const worktrees = [makeWorktree('a'), makeWorktree('z')]
    const breakdown = breakDownWorktreesHiddenByFilters(
      ['a'],
      ['a', 'z'],
      byId(worktrees),
      resolverFrom({})
    )
    expect(breakdown.total).toBe(0)
  })

  it('leaves out archived worktrees and ids the store no longer has', () => {
    const worktrees = [
      makeWorktree('a'),
      makeWorktree('b', { isArchived: true }),
      makeWorktree('c')
    ]
    const breakdown = breakDownWorktreesHiddenByFilters(
      ['a', 'b', 'c', 'gone'],
      ['a'],
      byId(worktrees),
      resolverFrom({ b: 'cli', c: 'cli', gone: 'cli' })
    )
    expect(breakdown).toEqual({ total: 1, counts: [{ filter: 'cli', count: 1 }], hiddenIds: ['c'] })
  })

  it('counts a folder workspace without a branch as sleeping, never as detached HEAD', () => {
    const folder = makeWorktree('folder', { branch: '', head: '', isMainWorktree: true })
    const hidingFilterOf = createSidebarHidingFilterResolver({
      filterRepoIds: [],
      showSleepingWorkspaces: false,
      alwaysShowDefaultBranchWorkspace: false,
      tabsByWorktree: {},
      ptyIdsByTabId: {},
      browserTabsByWorktree: {},
      worktreeIdsWithLiveAgent: new Set(),
      hideDefaultBranchWorkspace: true,
      hideAutomationGeneratedWorkspaces: false,
      hideCliCreatedWorkspaces: false,
      hideDetachedHeadWorkspaces: true,
      hideWorkspacesFromOtherDevices: false,
      pairedDeviceIdsByEnvironment: new Map(),
      repoMap: new Map(),
      workspaceHostScope: 'all',
      defaultHostId: LOCAL_EXECUTION_HOST_ID
    })
    const breakdown = breakDownWorktreesHiddenByFilters(
      ['folder'],
      [],
      byId([folder]),
      hidingFilterOf
    )
    expect(breakdown.counts).toEqual([{ filter: 'sleeping', count: 1 }])
  })
})
