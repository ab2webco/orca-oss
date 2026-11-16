// ORCA-1192: a terminal opened from the tab bar's + menu brings its workspace row into view.
import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AppState } from '../types'
import { createTestStore, makeWorktree, seedStore, TEST_REPO } from './store-test-helpers'

vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: vi.fn()
}))

function seedActive(store: ReturnType<typeof createTestStore>, workspaceId: string): void {
  seedStore(store, {
    activeWorktreeId: workspaceId,
    settings: { activeRuntimeEnvironmentId: null } as AppState['settings'],
    worktreesByRepo: {
      [TEST_REPO.id]: [makeWorktree({ id: 'wt-1', repoId: TEST_REPO.id })]
    },
    groupsByWorktree: {
      [workspaceId]: [{ id: 'group-1', worktreeId: workspaceId, activeTabId: null, tabOrder: [] }]
    },
    activeGroupIdByWorktree: { [workspaceId]: 'group-1' },
    groupBy: 'repo',
    filterRepoIds: ['other-repo']
  })
}

describe('+ menu terminal reveal', () => {
  it('reveals the active worktree passively, leaving grouping and filters alone', async () => {
    const store = createTestStore()
    seedActive(store, 'wt-1')

    await store.getState().openNewTerminalTabInActiveWorkspace('group-1')

    expect(store.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(store.getState().pendingRevealWorktree).toEqual({
      worktreeId: 'wt-1',
      behavior: 'smooth',
      passive: true
    })
    expect(store.getState().groupBy).toBe('repo')
    expect(store.getState().filterRepoIds).toEqual(['other-repo'])
  })

  it('reveals a folder workspace by its folder key', async () => {
    const store = createTestStore()
    const workspaceKey = folderWorkspaceKey('folder-1')
    seedActive(store, workspaceKey)

    await store.getState().openNewTerminalTabInActiveWorkspace('group-1')

    expect(store.getState().pendingRevealWorktree?.worktreeId).toBe(workspaceKey)
  })

  it('does not reveal the floating terminal, which has no sidebar row', async () => {
    const store = createTestStore()
    seedActive(store, FLOATING_TERMINAL_WORKTREE_ID)

    await store.getState().openNewTerminalTabInActiveWorkspace('group-1')

    expect(store.getState().tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]).toHaveLength(1)
    expect(store.getState().pendingRevealWorktree).toBeNull()
  })
})
