import { useAppStore } from '@/store'
import { rightSidebarWouldOverlay } from '@/components/right-sidebar/right-sidebar-width'

// Why one-shot: V30 opens on Team, but once the person picks a tab, or Orca applied it, it never forces it again.
const DEFAULTED_KEY = '_rightSidebarTeamTabDefaulted'
let defaulted: boolean | null = null

/** Whether the Team tab default was applied or the person already picked a tab; read once per session. */
export async function readTeamTabDefaulted(): Promise<boolean> {
  if (defaulted === null) {
    const ui = await window.api.ui.get().catch(() => null)
    defaulted ??= ui?.[DEFAULTED_KEY] === true
  }
  return defaulted
}

export function markTeamTabDefaulted(): void {
  if (defaulted === true) {
    return
  }
  defaulted = true
  void window.api.ui.set({ [DEFAULTED_KEY]: true }).catch(() => undefined)
}

/** Tests reset the session memory between cases. */
export function resetTeamTabDefaultedForTests(): void {
  defaulted = null
}

function showsWorktreeProject(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const active = state.activeWorktreeId
  if (!active) {
    return false
  }
  if (active === worktreeId) {
    return true
  }
  const repoId = state.getKnownWorktreeById(worktreeId)?.repoId
  return repoId !== undefined && state.getKnownWorktreeById(active)?.repoId === repoId
}

/** A lead start opens the right sidebar on Team where its project is shown; terminal focus stays put. */
export function openTeamTabOnLeadStart(worktreeId: string): void {
  if (!showsWorktreeProject(worktreeId)) {
    return
  }
  const state = useAppStore.getState()
  // Why: an overlaid sidebar would cover the left sidebar and content the person is using.
  if (
    !state.rightSidebarOpen &&
    rightSidebarWouldOverlay({
      windowWidth: window.innerWidth,
      sidebarOpen: state.sidebarOpen,
      sidebarWidth: state.sidebarWidth,
      rightSidebarWidth: state.rightSidebarWidth,
      activityBarPosition: state.activityBarPosition
    })
  ) {
    return
  }
  state.setRightSidebarTab('team')
  state.setRightSidebarOpen(true)
  markTeamTabDefaulted()
}
