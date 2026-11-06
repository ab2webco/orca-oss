import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TeamSessionRef } from '../../../../shared/team-panel-model-types'

const OPEN_TIMEOUT_MS = 15_000

function focusLoadedPane(ref: TeamSessionRef): boolean {
  const pane = parsePaneKey(ref.paneKey)
  const tabs = ref.worktreeId ? useAppStore.getState().tabsByWorktree[ref.worktreeId] : undefined
  if (!pane || !ref.worktreeId || !tabs?.some((tab) => tab.id === pane.tabId)) {
    return false
  }
  // Why the sidebar row's path: it keeps nav history and the left row selected.
  activateAndRevealWorktree(ref.worktreeId)
  activateTabAndFocusPane(pane.tabId, pane.leafId, {
    ackPaneKeyOnSuccess: ref.paneKey,
    flashFocusedPane: true,
    scrollToBottomIfOutputSinceLastView: true
  })
  return true
}

async function focusThroughHost(ref: TeamSessionRef): Promise<boolean> {
  if (!ref.terminalHandle) {
    return false
  }
  if (ref.host.kind === 'remote') {
    if (!ref.host.environmentId) {
      return false
    }
    // Why this window's runtime: it is the one paired with that host.
    await callRuntimeRpc(
      { kind: 'local' },
      'terminal.revealPaired',
      { terminal: ref.terminalHandle, on: ref.host.environmentId },
      { timeoutMs: OPEN_TIMEOUT_MS }
    )
    return true
  }
  await callRuntimeRpc(
    gameInboxTargetOf(useAppStore.getState().activeWorkspaceExecutionHostId),
    'terminal.focus',
    { terminal: ref.terminalHandle },
    { timeoutMs: OPEN_TIMEOUT_MS }
  )
  return true
}

/** Opens a lead's or member's own terminal in the center; the Team tab stays open beside it. */
export async function openTeamSession(ref: TeamSessionRef, name: string): Promise<void> {
  if (ref.host.kind === 'local' && focusLoadedPane(ref)) {
    return
  }
  const opened = await focusThroughHost(ref).catch(() => false)
  if (!opened) {
    toast.error(translate('teamPanel.open.failed', 'Could not open {{name}}', { name }))
  }
}
