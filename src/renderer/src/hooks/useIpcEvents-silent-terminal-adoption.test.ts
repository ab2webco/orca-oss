import { describe, expect, it, vi } from 'vitest'
import {
  createHarnessStoreState,
  loadIpcEventsHarness,
  type HarnessStoreState
} from './ipc-events-test-harness'

describe('useIpcEvents silent terminal adoption (surfaceOwner: false)', () => {
  const asMock = (value: unknown): ReturnType<typeof vi.fn> => value as ReturnType<typeof vi.fn>

  function createBackgroundWorkspaceState(): HarnessStoreState {
    return createHarnessStoreState({
      tabsByWorktree: {},
      // Honour the pre-minted tab id so adoption resolves the same tab main asked for.
      createTab: vi.fn(
        (_worktreeId: string, _groupId?: string, _tabType?: string, options?: { id?: string }) => ({
          id: options?.id ?? 'tab-minted'
        })
      ),
      worktreesByRepo: {
        'repo-1': [
          { id: 'wt-1', repoId: 'repo-1' },
          { id: 'wt-2', repoId: 'repo-1' }
        ]
      }
    })
  }

  async function focusMocks(): Promise<ReturnType<typeof vi.fn>[]> {
    const { focusTerminalTabSurface } = await import('@/lib/focus-terminal-tab-surface')
    const { focusRuntimeTerminalSurface } = await import('@/runtime/sync-runtime-graph')
    return [asMock(focusTerminalTabSurface), asMock(focusRuntimeTerminalSurface)]
  }

  it('adopts a background workspace terminal with a passive reveal and no focus move (ORCA-1192)', async () => {
    const storeState = createBackgroundWorkspaceState()
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    // Control: `orca terminal create` (no surfaceOwner) keeps its reveal so the
    // user can find the terminal they just asked for.
    harness.createTerminal({
      worktreeId: 'wt-2',
      ptyId: 'pty-cli',
      activate: false,
      tabId: 'tab-cli'
    })

    expect(storeState.createTab).toHaveBeenCalledWith('wt-2', undefined, undefined, {
      initialPtyId: 'pty-cli',
      activate: false,
      id: 'tab-cli'
    })
    expect(storeState.revealWorktreeInSidebar).toHaveBeenCalledWith('wt-2')

    asMock(storeState.createTab).mockClear()
    asMock(storeState.revealWorktreeInSidebar).mockClear()
    asMock(storeState.setActiveView).mockClear()
    asMock(storeState.setActiveWorktree).mockClear()
    asMock(storeState.setActiveTabType).mockClear()
    asMock(storeState.setActiveTab).mockClear()

    for (const focus of await focusMocks()) {
      focus.mockClear()
    }
    // A lead member launch / background workspace spawns its terminal here: the tab is
    // adopted and its row scrolled into view, but nothing is activated or focused.
    harness.createTerminal({
      worktreeId: 'wt-2',
      ptyId: 'pty-background-create',
      activate: false,
      surfaceOwner: false,
      tabId: 'tab-background-create'
    })

    expect(storeState.createTab).toHaveBeenCalledWith('wt-2', undefined, undefined, {
      initialPtyId: 'pty-background-create',
      activate: false,
      id: 'tab-background-create'
    })
    expect(storeState.revealWorktreeInSidebar).toHaveBeenCalledWith('wt-2', { passive: true })
    for (const focus of await focusMocks()) {
      expect(focus).not.toHaveBeenCalled()
    }
    expect(storeState.setActiveView).not.toHaveBeenCalled()
    expect(storeState.setActiveWorktree).not.toHaveBeenCalled()
    expect(storeState.setActiveTabType).not.toHaveBeenCalled()
    expect(storeState.setActiveTab).not.toHaveBeenCalled()
  })

  it('replies to a requested terminal create with a passive reveal when surfaceOwner is false', async () => {
    const storeState = createBackgroundWorkspaceState()
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    // Control: the same request without surfaceOwner still reveals its workspace.
    harness.requestTerminalCreate({
      requestId: 'req-cli',
      worktreeId: 'wt-2',
      title: 'Claude'
    })

    expect(harness.replyTerminalCreate).toHaveBeenCalledWith({
      requestId: 'req-cli',
      tabId: 'tab-minted',
      title: 'Claude'
    })
    expect(storeState.revealWorktreeInSidebar).toHaveBeenCalledWith('wt-2')

    asMock(storeState.createTab).mockClear()
    asMock(storeState.revealWorktreeInSidebar).mockClear()
    asMock(storeState.setActiveView).mockClear()
    asMock(storeState.setActiveWorktree).mockClear()
    asMock(storeState.setActiveTabType).mockClear()
    asMock(storeState.setActiveTab).mockClear()
    harness.replyTerminalCreate.mockClear()
    for (const focus of await focusMocks()) {
      focus.mockClear()
    }

    harness.requestTerminalCreate({
      requestId: 'req-background-create',
      worktreeId: 'wt-2',
      title: 'Claude',
      surfaceOwner: false
    })

    expect(storeState.createTab).toHaveBeenCalledWith('wt-2', undefined, undefined, {
      activate: false,
      recordInteraction: false
    })
    expect(harness.replyTerminalCreate).toHaveBeenCalledWith({
      requestId: 'req-background-create',
      tabId: 'tab-minted',
      title: 'Claude'
    })
    expect(storeState.revealWorktreeInSidebar).toHaveBeenCalledWith('wt-2', { passive: true })
    for (const focus of await focusMocks()) {
      expect(focus).not.toHaveBeenCalled()
    }
    expect(storeState.setActiveView).not.toHaveBeenCalled()
    expect(storeState.setActiveWorktree).not.toHaveBeenCalled()
    expect(storeState.setActiveTabType).not.toHaveBeenCalled()
    expect(storeState.setActiveTab).not.toHaveBeenCalled()
  })

  it('keeps the sidebar put when a background create adopts a tab that already exists', async () => {
    const storeState = createBackgroundWorkspaceState()
    storeState.tabsByWorktree = { 'wt-2': [{ id: 'tab-existing', ptyId: 'pty-bg' }] }
    storeState.ptyIdsByTabId = { 'tab-existing': ['pty-bg'] }
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    harness.createTerminal({ worktreeId: 'wt-2', ptyId: 'pty-bg', presentation: 'background' })

    expect(storeState.createTab).not.toHaveBeenCalled()
    expect(storeState.revealWorktreeInSidebar).not.toHaveBeenCalled()
  })
})
