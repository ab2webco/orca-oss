import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TeamLeadTurn } from './TeamActionDock'

/** The lead pane's hook status as the dock reads it; null when this window has none. */
export function teamLeadTurnOf(
  entry:
    | Pick<
        AgentStatusEntry,
        'state' | 'stateStartedAt' | 'lastAssistantMessage' | 'lastCompletedAssistantMessage'
      >
    | undefined
): TeamLeadTurn | null {
  if (!entry) {
    return null
  }
  return {
    state: entry.state,
    stateStartedAt: entry.stateStartedAt,
    // Why live first: the completed field only moves on the next turn, so it holds the one before.
    reply: entry.lastAssistantMessage ?? entry.lastCompletedAssistantMessage ?? null
  }
}
