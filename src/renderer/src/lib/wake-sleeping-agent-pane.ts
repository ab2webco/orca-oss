import {
  WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT,
  type WakeHibernatedAgentsWorktreeDetail
} from '@/constants/terminal'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import { useAppStore } from '@/store'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import { launchSleepingAgentSession } from './sleeping-agent-session-launch'
import { getProviderSessionClaimKey } from './sleeping-agent-pane-ownership'

export type SleepingAgentPaneWake = 'woken' | 'mounted' | 'launched' | 'failed' | 'not-sleeping'

/**
 * Wakes one slept agent pane on the host renderer without navigating, for
 * `terminal.wake` from the CLI or a paired client (ORCA-915). Uses the same
 * paths the UI does: the mounted pane's armed `--resume`, the cold restore its
 * tab takes when mounted, or a fresh tab for a session whose tab is gone.
 */
export function wakeSleepingAgentPaneInBackground(paneKey: string): SleepingAgentPaneWake {
  const state = useAppStore.getState()
  const record = state.sleepingAgentSessionsByPaneKey[paneKey]
  if (!record) {
    return 'not-sleeping'
  }
  const { worktreeId } = record
  const target = getProviderSessionClaimKey(record)
  // Why pre-claim: mounted panes skip claimed sessions, so only this pane's wakes in place.
  const wokenClaimKeys = new Set(
    Object.values(state.sleepingAgentSessionsByPaneKey)
      .filter((other) => other.worktreeId === worktreeId)
      .map(getProviderSessionClaimKey)
      .filter((claim) => claim !== target)
  )
  window.dispatchEvent(
    new CustomEvent<WakeHibernatedAgentsWorktreeDetail>(WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT, {
      detail: { worktreeId, wokenClaimKeys }
    })
  )
  if (wokenClaimKeys.has(target)) {
    return 'woken'
  }
  const tabId =
    record.tabId ??
    parsePaneKey(paneKey)?.tabId ??
    parseLegacyNumericPaneKey(paneKey)?.tabId ??
    null
  const tabExists = (state.tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)
  // Why not for worktree-sleep: that sleep closed the pane, so only a fresh tab can resume it.
  if (tabId && tabExists && record.origin !== 'worktree-sleep') {
    requestBackgroundTerminalWorktreeMount({ worktreeId, tabIds: [tabId] })
    return 'mounted'
  }
  const launchedTabIds: string[] = []
  const launched = launchSleepingAgentSession(record, {
    suppressNavigation: true,
    onSessionLaunched: (launchedTabId) => launchedTabIds.push(launchedTabId)
  })
  if (!launched) {
    return 'failed'
  }
  if (launchedTabIds.length > 0) {
    requestBackgroundTerminalWorktreeMount({ worktreeId, tabIds: launchedTabIds })
  }
  return 'launched'
}
