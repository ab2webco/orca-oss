// ORCA-1216 §8 / ORCA-1192: a restore reveals the active workspace and names it on the Retomar strip.
import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { createUIStore } from './ui-slice-test-harness'

describe('restore reveal and the Retomar strip', () => {
  it('reveals the restored workspace without a highlight or rename, and names it on the strip', () => {
    const store = createUIStore()
    store.setState({ activeWorktreeId: 'wt-1', activeWorkspaceKey: null })
    const before = store.getState()

    store.getState().revealRestoredWorkspace()

    const after = store.getState()
    expect(after.resumeStripWorkspaceId).toBe('wt-1')
    expect(after.pendingRevealWorktree).toEqual({ worktreeId: 'wt-1', behavior: 'auto' })
    // Non-destructive: grouping and filters are what the person left.
    expect(after.groupBy).toBe(before.groupBy)
    expect(after.filterRepoIds).toBe(before.filterRepoIds)
    expect(after.activeWorktreeId).toBe('wt-1')
  })

  it('keys a restored folder workspace by its folder key', () => {
    const store = createUIStore()
    store.setState({ activeWorktreeId: null, activeWorkspaceKey: 'folder:notes' })

    store.getState().revealRestoredWorkspace()

    expect(store.getState().resumeStripWorkspaceId).toBe('folder:notes')
    expect(store.getState().pendingRevealWorktree?.worktreeId).toBe('folder:notes')
  })

  it('shows nothing when no workspace was restored, or only the floating terminal', () => {
    const store = createUIStore()
    store.setState({ activeWorktreeId: null, activeWorkspaceKey: null })
    store.getState().revealRestoredWorkspace()
    expect(store.getState().resumeStripWorkspaceId).toBeNull()
    expect(store.getState().pendingRevealWorktree).toBeNull()

    store.setState({ activeWorktreeId: FLOATING_TERMINAL_WORKTREE_ID })
    store.getState().revealRestoredWorkspace()
    expect(store.getState().resumeStripWorkspaceId).toBeNull()
    expect(store.getState().pendingRevealWorktree).toBeNull()
  })

  it('dismisses the strip', () => {
    const store = createUIStore()
    store.setState({ activeWorktreeId: 'wt-1' })
    store.getState().revealRestoredWorkspace()

    store.getState().dismissResumeStrip()

    expect(store.getState().resumeStripWorkspaceId).toBeNull()
  })

  it('carries a passive reveal so an unrendered row is dropped instead of revealed later', () => {
    const store = createUIStore()

    store.getState().revealWorktreeInSidebar('wt-2', { passive: true })

    expect(store.getState().pendingRevealWorktree).toEqual({
      worktreeId: 'wt-2',
      behavior: 'smooth',
      passive: true
    })
  })
})
