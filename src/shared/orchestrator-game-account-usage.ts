import type { AccountListEntry } from './managed-account-list-entries'
import type {
  GameAccountStop,
  GameAccountUsage,
  GameQuotaWindow
} from './orchestrator-game-account-pick'
import { ticketOfMember } from './orchestrator-game-fleet-verbs'
import type { GameAccountProvider } from './orchestrator-game-member-agent'
import type { GameAgent } from './orchestrator-game-state'

/** Tickets of members launched in this same command, by account id, not yet in game.state. */
export type GameLaunchedOnAccount = Map<string, string[]>

const windowOf = (
  window: { usedPercent: number; resetsAt: number | null } | null | undefined
): GameQuotaWindow | null =>
  window ? { usedPercent: window.usedPercent, resetsAt: window.resetsAt } : null

/** Each member's ticket (or name) under the account id it runs on. */
export function gameMembersByAccountOf(agents: readonly GameAgent[]): Map<string, string[]> {
  const byAccount = new Map<string, string[]>()
  for (const agent of agents) {
    if (agent.isMember && !agent.isLeader && agent.account) {
      const tickets = byAccount.get(agent.account.id) ?? []
      tickets.push(ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey)
      byAccount.set(agent.account.id, tickets)
    }
  }
  return byAccount
}

/** Accounts `accounts: auto` may pick: on this host, Anthropic or OpenAI sign-ins, not known broken. */
export function isAutoPickableAccount(entry: AccountListEntry): boolean {
  return (
    entry.runtime === 'host' &&
    entry.authMethod !== 'custom-endpoint' &&
    entry.auth?.state !== 'failed'
  )
}

/** The latest limit a member stopped on, by the account id it runs on. */
function stoppedByAccountOf(agents: readonly GameAgent[]): Map<string, GameAccountStop> {
  const byAccount = new Map<string, GameAccountStop>()
  for (const agent of agents) {
    if (agent.isMember && !agent.isLeader && agent.account && agent.limit) {
      const seen = byAccount.get(agent.account.id)
      const resetsAt =
        seen === undefined
          ? agent.limit.resetsAt
          : seen.resetsAt === null || agent.limit.resetsAt === null
            ? null
            : Math.max(seen.resetsAt, agent.limit.resetsAt)
      const loggedOut = seen?.loggedOut === true || agent.limit.loggedOut === true
      byAccount.set(agent.account.id, loggedOut ? { resetsAt: null, loggedOut } : { resetsAt })
    }
  }
  return byAccount
}

/** Whether the project's `orchestrator.accounts` list (emails or ids) allows this account. */
export function isAllowedGameAccount(
  entry: { id: string; email: string },
  allowed: readonly string[] | undefined
): boolean {
  return (
    allowed === undefined ||
    allowed.some((one) => one === entry.id || one.toLowerCase() === entry.email.toLowerCase())
  )
}

export function gameAccountUsagesOf(args: {
  entries: readonly AccountListEntry[]
  provider: GameAccountProvider
  agents: readonly GameAgent[]
  launched?: GameLaunchedOnAccount
  allowed?: readonly string[]
}): GameAccountUsage[] {
  const members = gameMembersByAccountOf(args.agents)
  const stopped = stoppedByAccountOf(args.agents)
  return args.entries
    .filter(
      (entry) => entry.provider === args.provider && isAllowedGameAccount(entry, args.allowed)
    )
    .map((entry) => {
      // Why: 'unavailable' means the provider reports no quota for it, which is no reading at all.
      const quota = entry.quota?.status === 'unavailable' ? null : entry.quota
      return {
        provider: entry.provider,
        id: entry.id,
        email: entry.email,
        session: windowOf(quota?.session),
        weekly: windowOf(quota?.weekly),
        members: [...(members.get(entry.id) ?? []), ...(args.launched?.get(entry.id) ?? [])],
        ...(stopped.has(entry.id) ? { stopped: stopped.get(entry.id) } : {})
      }
    })
}

/** Another host's 5h and 7d reading of an account, matched by provider and email (ORCA-1028). */
export type GameAccountReading = {
  provider: GameAccountProvider
  email: string
  session: GameQuotaWindow | null
  weekly: GameQuotaWindow | null
}

/** This host's readings of one provider's accounts, for a paired host whose cache is empty. */
export function gameAccountReadingsOf(
  entries: readonly AccountListEntry[],
  provider: GameAccountProvider
): GameAccountReading[] {
  return gameAccountUsagesOf({ entries, provider, agents: [] })
    .filter((usage) => usage.session !== null || usage.weekly !== null)
    .map(({ email, session, weekly }) => ({ provider, email, session, weekly }))
}

// Why only gaps: quota belongs to the account, not the host, so another host's reading is valid, but this host's own is fresher.
export function withSharedGameReadings(
  usages: readonly GameAccountUsage[],
  readings: readonly GameAccountReading[] | undefined
): GameAccountUsage[] {
  return usages.map((usage) => {
    if (usage.session !== null || usage.weekly !== null) {
      return usage
    }
    const shared = readings?.find(
      (reading) =>
        reading.provider === usage.provider &&
        reading.email.toLowerCase() === usage.email.toLowerCase()
    )
    return shared ? { ...usage, session: shared.session, weekly: shared.weekly } : usage
  })
}
