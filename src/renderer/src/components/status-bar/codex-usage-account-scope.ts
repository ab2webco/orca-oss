import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'

export type CodexUsageAccountRef = {
  id: string
  email: string
}

export type CodexUsageAccountScopeInput = {
  /** GlobalSettings.showWorktreeAccountUsage; undefined means default-on. */
  showWorktreeAccountUsage: boolean | undefined
  /** Codex account pin of the focused worktree; null/undefined = inherit global. */
  focusedWorktreeCodexAccountId: string | null | undefined
  /** Managed account currently active for the displayed runtime target. */
  activeCodexAccountId: string | null
  /** Managed account roster used to resolve the pin into an email label. */
  accounts: readonly CodexUsageAccountRef[]
  /** Live usage snapshot of the globally active account. */
  activeAccountLimits: ProviderRateLimits | null
  /** Per-account usage cache populated for the switcher rows. */
  inactiveAccountUsage: readonly InactiveAccountUsage[]
}

export type CodexUsageAccountScope =
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
 * Which Codex account is in effect for a worktree: its pin when set and still
 * present, otherwise the globally active account. Codex has no custom-endpoint
 * accounts, so there is no endpoint variant to mirror from the Claude resolver.
 */
export type WorktreeCodexAccountResolution<A> =
  | { kind: 'global'; account: A | null }
  | { kind: 'pinned'; account: A }

export function resolveWorktreeCodexAccount<A extends { id: string }>(input: {
  /** Worktree's Codex account pin; null/undefined = inherit global. */
  pinnedAccountId: string | null | undefined
  /** Globally active account for the worktree's runtime. */
  activeAccountId: string | null
  accounts: readonly A[]
}): WorktreeCodexAccountResolution<A> {
  const activeAccount =
    input.accounts.find((account) => account.id === input.activeAccountId) ?? null
  const pinnedId = input.pinnedAccountId ?? null
  if (pinnedId === null) {
    return { kind: 'global', account: activeAccount }
  }
  const pinnedAccount = input.accounts.find((account) => account.id === pinnedId)
  if (!pinnedAccount) {
    // Why: a dangling pin (account removed) falls back to the global account.
    return { kind: 'global', account: activeAccount }
  }
  return { kind: 'pinned', account: pinnedAccount }
}

/**
 * Decides whose usage the Codex meters display: the globally active account,
 * or the managed account the focused worktree is pinned to.
 */
export function resolveCodexUsageAccountScope(
  input: CodexUsageAccountScopeInput
): CodexUsageAccountScope {
  // Why: undefined means the setting was never persisted; the feature defaults on.
  if (input.showWorktreeAccountUsage === false) {
    return { kind: 'global', limits: input.activeAccountLimits }
  }
  const resolution = resolveWorktreeCodexAccount({
    pinnedAccountId: input.focusedWorktreeCodexAccountId,
    activeAccountId: input.activeCodexAccountId,
    accounts: input.accounts
  })
  if (resolution.kind === 'global') {
    return { kind: 'global', limits: input.activeAccountLimits }
  }
  const pinnedId = resolution.account.id
  if (pinnedId === input.activeCodexAccountId) {
    // Why: the pin matches the active account, so the live snapshot is the
    // freshest per-account data available.
    return {
      kind: 'worktree',
      accountId: pinnedId,
      email: resolution.account.email,
      limits: input.activeAccountLimits,
      isFetching: false
    }
  }
  const usage = input.inactiveAccountUsage.find((entry) => entry.accountId === pinnedId)
  // Why: mirror the Claude resolver — a per-account fetch error should show as
  // pending (retry) rather than a permanent hard error on the worktree meter.
  const limits = usage?.rateLimits?.status === 'error' ? null : (usage?.rateLimits ?? null)
  return {
    kind: 'worktree',
    accountId: pinnedId,
    email: resolution.account.email,
    limits,
    isFetching: usage?.isFetching ?? false
  }
}

/** Placeholder limits so the meters render a loading state while the pinned
 *  account's usage has not been cached yet. */
export function createPendingCodexLimits(isFetching: boolean): ProviderRateLimits {
  return {
    provider: 'codex',
    session: null,
    weekly: null,
    updatedAt: 0,
    error: null,
    status: isFetching ? 'fetching' : 'idle'
  }
}
