import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TeamSessionRef } from '../../../../shared/team-panel-model-types'

/** Focuses the session's pane in the center, the same path a sidebar agent row takes. */
export function openTeamSession(ref: TeamSessionRef): boolean {
  const parsed = parsePaneKey(ref.paneKey)
  if (!parsed || !ref.worktreeId) {
    return false
  }
  const environmentId = ref.host.kind === 'remote' ? ref.host.environmentId : null
  if (environmentId) {
    activateAndRevealWorktree(ref.worktreeId, {
      executionHostId: toRuntimeExecutionHostId(environmentId)
    })
  } else {
    activateAndRevealWorktree(ref.worktreeId)
  }
  const tabs = useAppStore.getState().tabsByWorktree[ref.worktreeId] ?? []
  if (!tabs.some((tab) => tab.id === parsed.tabId)) {
    return false
  }
  activateTabAndFocusPane(parsed.tabId, parsed.leafId, {
    ackPaneKeyOnSuccess: ref.paneKey,
    flashFocusedPane: true,
    scrollToBottomIfOutputSinceLastView: true
  })
  return true
}
