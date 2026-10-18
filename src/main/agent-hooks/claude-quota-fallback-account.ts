import type { ClaudeManagedAccount } from '../../shared/types'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitState
} from '../../shared/rate-limit-types'

function hasQuota(limits: ProviderRateLimits | null | undefined): boolean {
  if (!limits || limits.status !== 'ok') {
    return false
  }
  return [limits.session, limits.weekly].every((window) => !window || window.usedPercent < 100)
}

/** First managed account with a fresh, non-exhausted reading that was not already tried; unknown usage never qualifies. */
export function pickClaudeQuotaFallbackAccountId(args: {
  accounts: readonly ClaudeManagedAccount[]
  activeAccountId: string | null
  rateLimits: Pick<RateLimitState, 'claude' | 'inactiveClaudeAccounts'>
  excludedAccountIds: readonly string[]
}): string | null {
  const inactive = new Map<string, InactiveAccountUsage>(
    args.rateLimits.inactiveClaudeAccounts.map((usage) => [usage.accountId, usage])
  )
  for (const account of args.accounts) {
    if (args.excludedAccountIds.includes(account.id)) {
      continue
    }
    const limits =
      account.id === args.activeAccountId
        ? args.rateLimits.claude
        : inactive.get(account.id)?.rateLimits
    if (hasQuota(limits)) {
      return account.id
    }
  }
  return null
}
