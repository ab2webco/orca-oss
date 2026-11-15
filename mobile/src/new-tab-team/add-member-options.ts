import {
  pickGameMemberAccount,
  type GameAccountUsage,
  type GameQuotaWindow
} from '../../../src/shared/orchestrator-game-account-pick'
import type { GameAccountProvider } from '../../../src/shared/orchestrator-game-member-agent'
import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import { teamCardsOf } from '../../../src/shared/team-panel-member-cards'
import type { TeamTodoTicket } from '../../../src/shared/team-panel-model-types'
import { teamMachinesSectionOf } from '../../../src/shared/team-panel-work-tabs'
import { teamTodoTicketsOf } from '../../../src/shared/team-todo-tickets'
import {
  getActiveProviderRateLimits,
  getInactiveProviderUsage
} from '../components/account-usage-state'
import type { AccountsSnapshot, RateLimitWindow } from '../components/accounts-snapshot'

/** `on` is the saved environment `orca game launch --on` takes; null is the lead's own desktop. */
export type AddMemberHost = { on: string | null; running: number; cap: number | null }

export type AddMemberRoster = {
  todo: TeamTodoTicket[]
  hosts: AddMemberHost[]
  /** The member agent's managed accounts; null for an agent Orca keeps no accounts for. */
  provider: GameAccountProvider | null
}

export type AddMemberAccount = { id: string; email: string; usedPercent: number | null }

export type AddMemberAccounts = { accounts: AddMemberAccount[]; defaultId: string | null }

/** What the Add member sheet offers, from the same builders the desktop Team panel uses. */
export function addMemberRosterOf(state: OrchestratorGameState): AddMemberRoster {
  const members = teamCardsOf(state, new Set())?.members ?? []
  const machines = teamMachinesSectionOf({ state, members })
  const hosts = (machines?.kind === 'ready' ? machines.value : []).flatMap(
    (one): AddMemberHost[] => {
      const base = { running: one.running, cap: one.cap }
      if (one.host.kind === 'local') {
        return [{ on: null, ...base }]
      }
      return one.host.reachable ? [{ on: one.host.name, ...base }] : []
    }
  )
  const agent = state.lead?.agent ?? 'claude'
  return {
    todo: teamTodoTicketsOf(state, members),
    hosts:
      hosts.length > 0
        ? hosts
        : [{ on: null, running: members.length, cap: state.lead?.cap ?? null }],
    provider: agent === 'claude' || agent === 'codex' ? agent : null
  }
}

const quotaOf = (window: RateLimitWindow | null | undefined): GameQuotaWindow | null =>
  window ? { usedPercent: window.usedPercent, resetsAt: window.resetsAt } : null

/** The accounts a member can run on, defaulting to the one the lead's `auto` would pick. */
export function addMemberAccountsOf(
  snapshot: AccountsSnapshot,
  provider: GameAccountProvider,
  now: number
): AddMemberAccounts {
  const { accounts, activeAccountId } = snapshot[provider]
  const usage: GameAccountUsage[] = accounts.map((account) => {
    const limits =
      account.id === activeAccountId
        ? getActiveProviderRateLimits(snapshot, provider)
        : (getInactiveProviderUsage(snapshot, provider, account.id)?.rateLimits ?? null)
    return {
      provider,
      id: account.id,
      email: account.email,
      session: quotaOf(limits?.session),
      weekly: quotaOf(limits?.weekly),
      members: []
    }
  })
  const pick = pickGameMemberAccount(usage, now)
  return {
    accounts: usage.map((one) => ({
      id: one.id,
      email: one.email,
      usedPercent: one.session ? Math.round(one.session.usedPercent) : null
    })),
    defaultId: pick.kind === 'account' ? pick.account.id : (usage[0]?.id ?? null)
  }
}
