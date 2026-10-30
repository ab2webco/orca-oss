import type { CommandHandler } from '../dispatch'
import { accountListEntriesOf, type RuntimeAccountsSnapshot } from '../account-format'
import { printResult } from '../format'
import {
  gameAccountUsagesOf,
  isAutoPickableAccount
} from '../../shared/orchestrator-game-account-usage'
import { tableOf } from './orchestrator-game-fleet-format'
import { readCallerGameState } from './orchestrator-game-launch'
import {
  gameAccountStandingOf,
  gameResetInText,
  pickGameMemberAccount,
  type GameAccountStanding,
  type GameQuotaWindow
} from '../../shared/orchestrator-game-account-pick'
import {
  GAME_ACCOUNT_PROVIDER_LABELS,
  type GameAccountProvider
} from '../../shared/orchestrator-game-member-agent'

type ReportWindow = { usedPercent: number; resetsAt: string | null }

export type GameAccountsRow = {
  id: string
  email: string
  session: ReportWindow | null
  weekly: ReportWindow | null
  standing: GameAccountStanding
  limited: boolean
  /** When a near or limited account is usable again. */
  usableAt: string | null
  members: string[]
  /** Whether `accounts: auto` may put a member on it (this host, not a custom endpoint, sign-in not failed). */
  autoPick: boolean
  /** A member on it stopped on a usage or spend limit its readings may not show. */
  memberStopped: boolean
}

export type GameAccountsReport = {
  providers: {
    provider: GameAccountProvider
    accounts: GameAccountsRow[]
    allLimited: boolean
    nextUsableAt: string | null
  }[]
}

const PROVIDERS: readonly GameAccountProvider[] = ['claude', 'codex']
// Why bounded: accounts.list waits on provider usage APIs that can stall behind broken auth.
const USAGE_REFRESH_TIMEOUT_MS = 20_000

const isoOf = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString()

const windowOf = (window: GameQuotaWindow | null): ReportWindow | null =>
  window && { usedPercent: Math.round(window.usedPercent), resetsAt: isoOf(window.resetsAt) }

/** Every managed account per provider with what the lead decides on; no credentials. */
export function gameAccountsReportOf(
  snapshot: RuntimeAccountsSnapshot,
  agents: Parameters<typeof gameAccountUsagesOf>[0]['agents'],
  now: number
): GameAccountsReport {
  const entries = accountListEntriesOf(snapshot)
  return {
    providers: PROVIDERS.map((provider) => {
      const usages = gameAccountUsagesOf({ entries, provider, agents })
      const accounts = usages.map((usage): GameAccountsRow => {
        const { standing, resetsAt } = gameAccountStandingOf(usage, now)
        const entry = entries.find((one) => one.provider === provider && one.id === usage.id)
        return {
          id: usage.id,
          email: usage.email,
          session: windowOf(usage.session),
          weekly: windowOf(usage.weekly),
          standing,
          limited: standing === 'limited',
          usableAt: isoOf(resetsAt),
          members: usage.members,
          autoPick: entry ? isAutoPickableAccount(entry) : false,
          memberStopped: usage.stopped !== undefined
        }
      })
      const pick = pickGameMemberAccount(usages, now)
      return {
        provider,
        accounts,
        allLimited: pick.kind === 'limited',
        nextUsableAt: pick.kind === 'limited' ? isoOf(pick.resetsAt) : null
      }
    })
  }
}

const msOf = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso))

function windowText(label: string, window: ReportWindow | null, now: number): string {
  if (!window) {
    return `${label} —`
  }
  const reset = window.resetsAt === null ? '' : ` (${gameResetInText(msOf(window.resetsAt), now)})`
  return `${label} ${window.usedPercent}%${reset}`
}

export function formatGameAccounts(report: GameAccountsReport, now = Date.now()): string {
  return report.providers
    .map(({ provider, accounts, allLimited, nextUsableAt }) => {
      const label = GAME_ACCOUNT_PROVIDER_LABELS[provider]
      const head = `${label} accounts (${accounts.length})`
      if (accounts.length === 0) {
        return `${head}: none managed in Orca; members use the agent's own login.`
      }
      const rows = accounts.map((row) => [
        row.email,
        windowText('5h', row.session, now),
        windowText('7d', row.weekly, now),
        row.memberStopped && row.limited
          ? `limited, member stopped on a limit, back ${gameResetInText(msOf(row.usableAt), now)}`
          : row.standing,
        row.members.join(', ') || '-',
        row.autoPick ? '' : 'not picked by auto'
      ])
      const waiting = allLimited
        ? [
            `Every ${label} account is at or near its limit; the first is usable again ${gameResetInText(msOf(nextUsableAt), now)}.`
          ]
        : []
      return [head, tableOf(rows), ...waiting].join('\n')
    })
    .join('\n\n')
}

export const ORCHESTRATOR_GAME_ACCOUNTS_HANDLERS: Record<string, CommandHandler> = {
  'game accounts': async ({ flags, client, json }) => {
    const state = await readCallerGameState(client)
    const snapshot =
      flags.get('refresh') === true
        ? await client.call<RuntimeAccountsSnapshot>(
            'accounts.list',
            { refreshUsage: true },
            { timeoutMs: USAGE_REFRESH_TIMEOUT_MS }
          )
        : await client.call<RuntimeAccountsSnapshot>('accounts.snapshot')
    const now = Date.now()
    printResult(
      { ...snapshot, result: gameAccountsReportOf(snapshot.result, state.result.agents, now) },
      json,
      (report) => formatGameAccounts(report, now)
    )
  }
}
