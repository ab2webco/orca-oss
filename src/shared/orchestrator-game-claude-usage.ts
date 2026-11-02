import { accountLimitsOf } from './orchestrator-game-member-limit'
import type { RateLimitState } from './rate-limit-types'

/** The managed Claude accounts' use for the scene's metrics widget (ORCA-774). */

export const GAME_CLAUDE_ACCOUNTS_MAX = 8

export type GameClaudeAccountUsage = {
  email: string
  active: boolean
  /** Percent of the 5-hour window used; null when not reported. */
  sessionPercent: number | null
  /** Percent of the 7-day window used; null when not reported. */
  weeklyPercent: number | null
}

/** Accounts with a good reading only, the active one first, then the busiest by weekly use. */
export function gameClaudeAccountsUsageOf(
  roster: { accounts: readonly { id: string; email: string }[]; activeAccountId: string | null },
  state: Pick<RateLimitState, 'claude' | 'inactiveClaudeAccounts'>
): GameClaudeAccountUsage[] {
  const limitsState = { ...state, codex: null, inactiveCodexAccounts: [] }
  return roster.accounts
    .flatMap((account) => {
      const limits = accountLimitsOf(limitsState, 'claude', account.id, roster.activeAccountId)
      return limits?.status === 'ok'
        ? [
            {
              email: account.email,
              active: account.id === roster.activeAccountId,
              sessionPercent: limits.session?.usedPercent ?? null,
              weeklyPercent: limits.weekly?.usedPercent ?? null
            }
          ]
        : []
    })
    .toSorted(
      (a, b) =>
        Number(b.active) - Number(a.active) || (b.weeklyPercent ?? -1) - (a.weeklyPercent ?? -1)
    )
    .slice(0, GAME_CLAUDE_ACCOUNTS_MAX)
}
