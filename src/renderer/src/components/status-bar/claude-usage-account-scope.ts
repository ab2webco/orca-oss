import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'

export type ClaudeUsageAccountRef = {
  id: string
  email: string
}

export type ClaudeUsageAccountScopeInput = {
  /** GlobalSettings.showWorktreeAccountUsage; undefined means default-on. */
  showWorktreeAccountUsage: boolean | undefined
  /** Claude account pin of the focused worktree; null/undefined = inherit global. */
  focusedWorktreeClaudeAccountId: string | null | undefined
  /** Managed account currently active for the displayed runtime target. */
  activeClaudeAccountId: string | null
  /** Managed account roster used to resolve the pin into an email label. */
  accounts: readonly ClaudeUsageAccountRef[]
  /** Live usage snapshot of the globally active account. */
  activeAccountLimits: ProviderRateLimits | null
  /** Per-account usage cache populated for the switcher rows. */
  inactiveAccountUsage: readonly InactiveAccountUsage[]
}

export type ClaudeUsageAccountScope =
  | { kind: 'global'; limits: ProviderRateLimits | null }
  | {
      kind: 'worktree'
      accountId: string
      email: string
      /** null while the pinned account's usage has not been fetched yet. */
      limits: ProviderRateLimits | null
      isFetching: boolean
    }

/**
 * Decides whose usage the Claude meters display: the globally active account,
 * or the managed account the focused worktree is pinned to.
 */
export function resolveClaudeUsageAccountScope(
  input: ClaudeUsageAccountScopeInput
): ClaudeUsageAccountScope {
  const pinnedId = input.focusedWorktreeClaudeAccountId ?? null
  // Why: undefined means the setting was never persisted; the feature defaults on.
  if (input.showWorktreeAccountUsage === false || pinnedId === null) {
    return { kind: 'global', limits: input.activeAccountLimits }
  }
  const pinnedAccount = input.accounts.find((account) => account.id === pinnedId)
  if (!pinnedAccount) {
    // Why: a dangling pin (account removed) must not blank the global meters.
    return { kind: 'global', limits: input.activeAccountLimits }
  }
  if (pinnedId === input.activeClaudeAccountId) {
    // Why: the pin matches the active account, so the live snapshot is the
    // freshest per-account data available.
    return {
      kind: 'worktree',
      accountId: pinnedId,
      email: pinnedAccount.email,
      limits: input.activeAccountLimits,
      isFetching: false
    }
  }
  const usage = input.inactiveAccountUsage.find((entry) => entry.accountId === pinnedId)
  return {
    kind: 'worktree',
    accountId: pinnedId,
    email: pinnedAccount.email,
    limits: usage?.rateLimits ?? null,
    isFetching: usage?.isFetching ?? false
  }
}

/** Placeholder limits so the meters render a loading state while the pinned
 *  account's usage has not been cached yet. */
export function createPendingClaudeLimits(isFetching: boolean): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 0,
    error: null,
    status: isFetching ? 'fetching' : 'idle'
  }
}
