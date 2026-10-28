import {
  AGENT_STATUS_STATES,
  type AgentStatusIpcPayload,
  type AgentStatusState
} from './agent-status-types'
import type { GameMemberLimit } from './orchestrator-game-member-limit'

/**
 * A remote member's agent as its host's Claude/Codex hooks report it, relayed on
 * `federationShow` (ORCA-837). Optional on the wire: an older host sends none.
 */
export type RemoteMemberAgent = {
  state: AgentStatusState
  agentType: string | null
  /** When the host last received a hook event for the pane (ms). */
  updatedAt: number
  limit?: GameMemberLimit
}

/** The host's hook reading for a pane; null without one, or when it is only restored from disk. */
export function remoteMemberAgentOf(
  entries: readonly AgentStatusIpcPayload[],
  paneKey: string | null
): RemoteMemberAgent | null {
  const entry = paneKey ? entries.find((one) => one.paneKey === paneKey) : undefined
  if (!entry || entry.restoredUnconfirmed || entry.providerSessionOnly) {
    return null
  }
  return {
    state: entry.state,
    agentType: entry.agentType ?? null,
    updatedAt: entry.receivedAt
  }
}

/** What a host relayed, or null when it relayed nothing usable. */
export function parseRemoteMemberAgent(value: unknown): RemoteMemberAgent | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { state, agentType, updatedAt, limit } = value as Record<string, unknown>
  if (
    !AGENT_STATUS_STATES.includes(state as AgentStatusState) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt)
  ) {
    return null
  }
  const resetsAt = (limit as { resetsAt?: unknown } | undefined)?.resetsAt
  return {
    state: state as AgentStatusState,
    agentType: typeof agentType === 'string' ? agentType : null,
    updatedAt,
    ...(limit && (resetsAt === null || typeof resetsAt === 'number') ? { limit: { resetsAt } } : {})
  }
}
