import type { StoreApi } from 'zustand'
import type { AppState } from '../../../src/renderer/src/store/types'
import type { OpenFile, RightSidebarTab } from '../../../src/renderer/src/store/slices/editor'
import type { ManagedPane } from '../../../src/renderer/src/lib/pane-manager/pane-manager-types'
import type { BrowserWorkspace } from '../../../src/shared/browser-workspace-types'
import type { Repo } from '../../../src/shared/repo-types'
import type { WorkspaceVisibleTabType } from '../../../src/shared/tab-types'
import type { TerminalTab } from '../../../src/shared/terminal-tab-types'
import type { Worktree } from '../../../src/shared/worktree/types'

// Why the real store type: the app assigns the whole zustand store to
// window.__store (store/index.ts), so declaring only getState made every spec
// that calls setState typecheck against a shape the runtime never had.
export type AppStore = StoreApi<AppState>

// Why no __paneManagers here: src/renderer/src/env.d.ts already declares it as
// the real Map<string, PaneManager>, and re-declaring a narrower shape shadowed
// every method the specs actually call.
export type PaneManagerLike = {
  getActivePane?(): ManagedPane | null
  getPanes?(): ManagedPane[]
  splitPane?(paneId: number, direction: 'vertical' | 'horizontal'): ManagedPane | null
  closePane?(paneId: number): void
  setActivePane?(paneId: number, opts?: { focus?: boolean }): void
  suspendRendering?(): void
  resumeRendering?(): void
}

export type ExplorerFileSummary = Pick<OpenFile, 'id' | 'filePath' | 'relativePath'>
export type BrowserTabSummary = Pick<BrowserWorkspace, 'id' | 'url' | 'title'>
export type TerminalTabSummary = Pick<TerminalTab, 'id' | 'title' | 'customTitle'>
export type SidebarStateSummary = {
  rightSidebarOpen: boolean
  rightSidebarTab: RightSidebarTab
}
export type TestRepoState = {
  repos: Repo[]
  worktreesByRepo: Record<string, Worktree[]>
}
export type TerminalViewState = {
  activeTabId: string | null
  activeTabType: WorkspaceVisibleTabType
  activeWorktreeId: string | null
  ptyIdsByTabId: Record<string, string[]>
  tabsByWorktree: Record<string, TerminalTab[]>
}

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __store?: AppStore
  }
}

export function getWindowStore(): AppStore | null {
  return window.__store ?? null
}

export function getAppState(): AppState {
  const store = getWindowStore()
  if (!store) {
    throw new Error('window.__store is not available — is the app in dev mode?')
  }

  return store.getState()
}
