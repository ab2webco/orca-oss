import {
  AGENT_STATUS_STATES,
  type AgentStatusIpcPayload,
  type AgentStatusState
} from './agent-status-types'
import type { GameMemberLimit } from './orchestrator-game-member-limit'
import { accountProviderOfAgent, type GameAccountProvider } from './orchestrator-game-member-agent'
import {
  GAME_MEMBER_ADVISOR_VERSION,
  parseGameMemberAdvisorReport,
  type GameMemberAdvisor
} from './orchestrator-game-member-advisor'
import { gameMemberLaunchOf, type GameMemberLaunch } from './orchestrator-game-member-launch'

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
  /** The tool the pane's hooks say it runs; absent from an older host (ORCA-933). */
  toolName?: string
  /** The Jev report the member's pane posted to its host; absent without Jev or from an older host. */
  advisor?: GameMemberAdvisor
  /** The model its hooks named, else its launch's; absent when neither named one or from an older host. */
  launch?: GameMemberLaunch
}

const TOOL_NAME_MAX = 64

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
    ...(Number.isFinite(entry.stateStartedAt) ? { stateStartedAt: entry.stateStartedAt } : {}),
    ...(entry.toolName ? { toolName: entry.toolName } : {})
  }
}

/** What a host relayed, or null when it relayed nothing usable. */
export function parseRemoteMemberAgent(value: unknown): RemoteMemberAgent | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { state, agentType, updatedAt, stateStartedAt, limit, account, globalLogin } =
    value as Record<string, unknown>
  const { toolName, advisor, launch } = value as Record<string, unknown>
  if (
    !AGENT_STATUS_STATES.includes(state as AgentStatusState) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt)
  ) {
    return null
  }
  const resetsAt = (limit as { resetsAt?: unknown } | undefined)?.resetsAt
  const relayed = relayedAccountOf(account)
  const relayedAdvisor = relayedAdvisorOf(advisor)
  const relayedLaunch = gameMemberLaunchOf(launch)
  return {
    state: state as AgentStatusState,
    agentType: typeof agentType === 'string' ? agentType : null,
    updatedAt,
    ...(typeof stateStartedAt === 'number' && Number.isFinite(stateStartedAt)
      ? { stateStartedAt }
      : {}),
    ...(limit && (resetsAt === null || typeof resetsAt === 'number')
      ? {
          limit: {
            resetsAt,
            ...((limit as { loggedOut?: unknown }).loggedOut === true
              ? { loggedOut: true as const }
              : {})
          }
        }
      : {}),
    ...(relayed
      ? { account: relayed }
      : globalLogin === true
        ? { globalLogin: true as const }
        : {}),
    ...(typeof toolName === 'string' && toolName !== ''
      ? { toolName: toolName.slice(0, TOOL_NAME_MAX) }
      : {}),
    ...(relayedAdvisor ? { advisor: relayedAdvisor } : {}),
    ...(relayedLaunch ? { launch: relayedLaunch } : {})
  }
}

// Why the version: the host relays the report it holds, which carries none; the pane's parser wants one.
function relayedAdvisorOf(value: unknown): GameMemberAdvisor | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const report = parseGameMemberAdvisorReport({ ...value, version: GAME_MEMBER_ADVISOR_VERSION })
  if (!report) {
    return null
  }
  const before = (value as { previous?: unknown }).previous
  const previous =
    typeof before === 'object' && before !== null
      ? parseGameMemberAdvisorReport({ ...before, version: GAME_MEMBER_ADVISOR_VERSION })
      : null
  return {
    ...report,
    ...(previous ? { previous: { model: previous.model, effort: previous.effort } } : {})
  }
}

function relayedAccountOf(value: unknown): RemoteMemberAgent['account'] | null {
  const { provider, email } = (value ?? {}) as Record<string, unknown>
  const known = accountProviderOfAgent(typeof provider === 'string' ? provider : null)
  return known && typeof email === 'string' && email !== '' ? { provider: known, email } : null
}
