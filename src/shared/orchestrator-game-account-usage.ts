import type { AccountListEntry } from './managed-account-list-entries'
import type { GameAccountUsage, GameQuotaWindow } from './orchestrator-game-account-pick'
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

export function gameAccountUsagesOf(args: {
  entries: readonly AccountListEntry[]
  provider: GameAccountProvider
  agents: readonly GameAgent[]
  launched?: GameLaunchedOnAccount
}): GameAccountUsage[] {
  const members = gameMembersByAccountOf(args.agents)
  return args.entries
    .filter((entry) => entry.provider === args.provider)
    .map((entry) => {
      // Why: 'unavailable' means the provider reports no quota for it, which is no reading at all.
      const quota = entry.quota?.status === 'unavailable' ? null : entry.quota
      return {
        provider: entry.provider,
        id: entry.id,
        email: entry.email,
        session: windowOf(quota?.session),
        weekly: windowOf(quota?.weekly),
        members: [...(members.get(entry.id) ?? []), ...(args.launched?.get(entry.id) ?? [])]
      }
    })
}
