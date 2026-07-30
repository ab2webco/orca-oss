import { useAppStore } from '@/store'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import type { WorktreeCreationPhase, WorktreeCreationRequest } from './pending-worktree-creation'

export function getWorktreeCreationIndeterminate(request: WorktreeCreationRequest): boolean {
  if (request.worktreeCreateProgressMode) {
    return request.worktreeCreateProgressMode === 'indeterminate'
  }
  return getActiveRuntimeTarget(useAppStore.getState().settings).kind !== 'local'
}

export function getInitialWorktreeCreationPhase(request: WorktreeCreationRequest): WorktreeCreationPhase {
  return request.ephemeralVmRecipe && !request.ephemeralVmRuntimeId ? 'provisioning-vm' : 'fetching'
}

// Why: activePendingCreationId can outlive the terminal route when the user
// switches app views; only the terminal route renders the creation panel.
export function isPendingCreationSurfaceVisible(creationId: string): boolean {
  const state = useAppStore.getState()
  return state.activeView === 'terminal' && state.activePendingCreationId === creationId
}

export function revealPendingCreation(
  creationId: string,
  request: WorktreeCreationRequest,
  phase: WorktreeCreationPhase
): void {
  const store = useAppStore.getState()
  const indeterminate = getWorktreeCreationIndeterminate(request)
  store.beginPendingWorktreeCreation({
    creationId,
    phase,
    status: 'creating',
    startedAt: Date.now(),
    indeterminate,
    // Why: the creation surface owns the tab strip immediately. Delaying this
    // caused the real workspace tab bar to flash out when the debounce elapsed.
    loaderVisible: true,
    request
  })
  // Why: the creation panel only renders under the terminal view (App content
  // router), so force it active so the panel is what fills the content area.
  store.setActiveView('terminal')
  store.setSidebarOpen(true)
}
