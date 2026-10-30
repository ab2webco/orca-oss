import {
  AGENT_STATUS_STATES,
  type AgentStatusIpcPayload,
  type AgentStatusState
} from './agent-status-types'
import type { GameMemberLimit } from './orchestrator-game-member-limit'
import { accountProviderOfAgent, type GameAccountProvider } from './orchestrator-game-member-agent'

/**
 * A remote member's agent as its host's Claude/Codex hooks report it, relayed on
 * `federationShow` (ORCA-837). Optional on the wire: an older host sends none.
 */
export type RemoteMemberAgent = {
  state: AgentStatusState
  agentType: string | null
  /** When the host last received a hook event for the pane (ms). */
  updatedAt: number
  /** When the pane's current state began (ms); absent from an older host. */
  stateStartedAt?: number
  limit?: GameMemberLimit
  /** The host's account the pane runs on; only its email crosses hosts (ORCA-798). */
  account?: { provider: GameAccountProvider; email: string }
  /** No managed account: the pane runs on the host's global login (ORCA-891); absent from an older host. */
  globalLogin?: true
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
    updatedAt: entry.receivedAt,
    ...(Number.isFinite(entry.stateStartedAt) ? { stateStartedAt: entry.stateStartedAt } : {})
  }
}

/** What a host relayed, or null when it relayed nothing usable. */
export function parseRemoteMemberAgent(value: unknown): RemoteMemberAgent | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { state, agentType, updatedAt, stateStartedAt, limit, account, globalLogin } =
    value as Record<string, unknown>
  if (
    !AGENT_STATUS_STATES.includes(state as AgentStatusState) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt)
  ) {
    return null
  }
  const resetsAt = (limit as { resetsAt?: unknown } | undefined)?.resetsAt
  const relayed = relayedAccountOf(account)
  return {
    state: state as AgentStatusState,
    agentType: typeof agentType === 'string' ? agentType : null,
    updatedAt,
    ...(typeof stateStartedAt === 'number' && Number.isFinite(stateStartedAt)
      ? { stateStartedAt }
      : {}),
    ...(limit && (resetsAt === null || typeof resetsAt === 'number')
      ? { limit: { resetsAt } }
      : {}),
    ...(relayed ? { account: relayed } : globalLogin === true ? { globalLogin: true as const } : {})
  }
}

function relayedAccountOf(value: unknown): RemoteMemberAgent['account'] | null {
  const { provider, email } = (value ?? {}) as Record<string, unknown>
  const known = accountProviderOfAgent(typeof provider === 'string' ? provider : null)
  return known && typeof email === 'string' && email !== '' ? { provider: known, email } : null
}
