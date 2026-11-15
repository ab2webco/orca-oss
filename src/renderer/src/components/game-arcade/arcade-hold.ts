import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import { stripLeadingAgentTitleDecoration } from '../../../../shared/agent-title-decoration'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'

export type ArcadeHoldSources = {
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>>
  ptyIdsByTabId: Record<string, string[]>
  tabsByWorktree: Readonly<Record<string, readonly TerminalTab[]>>
}

const tabIdOf = (entry: AgentStatusEntry, paneKey: string): string => {
  const key = entry.paneKey || paneKey
  return entry.tabId ?? key.slice(0, Math.max(0, key.indexOf(':')))
}

const tabOf = (sources: ArcadeHoldSources, tabId: string): TerminalTab | undefined => {
  for (const tabs of Object.values(sources.tabsByWorktree)) {
    const found = tabs.find((tab) => tab.id === tabId)
    if (found) {
      return found
    }
  }
  return undefined
}

const nameOf = (entry: AgentStatusEntry, tab: TerminalTab | undefined): string =>
  entry.orchestration?.displayName?.trim() ||
  (tab
    ? stripLeadingAgentTitleDecoration(resolveTerminalTabTitle(tab, false)).trim() ||
      tab.defaultTitle?.trim() ||
      ''
    : '')

/**
 * Who holds the run: a live agent blocked on a permission or waiting on the user, in any project.
 * Null when nobody does; an empty name when the pane has no label to show.
 * A sleeping or disconnected pane, or a row the tab bar's freshness gate calls stale, holds nothing.
 */
export function whoIsWaitingOnUser(
  sources: ArcadeHoldSources,
  now = Date.now()
): { paneKey: string; name: string } | null {
  let oldest: { paneKey: string; entry: AgentStatusEntry; tab: TerminalTab | undefined } | null =
    null
  for (const [paneKey, entry] of Object.entries(sources.agentStatusByPaneKey)) {
    if (entry.state !== 'blocked' && entry.state !== 'waiting') {
      continue
    }
    if (!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
      continue
    }
    const tabId = tabIdOf(entry, paneKey)
    if (!tabHasLivePty(sources.ptyIdsByTabId, tabId)) {
      continue
    }
    if (!oldest || entry.stateStartedAt < oldest.entry.stateStartedAt) {
      oldest = { paneKey, entry, tab: tabOf(sources, tabId) }
    }
  }
  return oldest ? { paneKey: oldest.paneKey, name: nameOf(oldest.entry, oldest.tab) } : null
}
