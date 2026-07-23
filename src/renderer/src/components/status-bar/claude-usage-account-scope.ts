import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'

export type ClaudeUsageAccountRef = {
  id: string
  email: string
  /** Optional so plain {id, email} rosters keep working; undefined means OAuth-like. */
  authMethod?: 'subscription-oauth' | 'custom-endpoint' | 'unknown'
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
  | {
      /** Pinned custom-endpoint account: no Anthropic usage API, never fetches. */
      kind: 'worktree-custom-endpoint'
      accountId: string
      email: string
    }

/**
 * Which Claude account is in effect for a worktree: its pin when set and still
 * present, otherwise the globally active account. Shared identity rule reused
 * by both the status-bar usage meters and the sidebar account chip.
 */
export type WorktreeClaudeAccountResolution<A> =
  | { kind: 'global'; account: A | null }
  | { kind: 'pinned'; account: A }
  | { kind: 'pinned-endpoint'; account: A }

export function resolveWorktreeClaudeAccount<A extends { id: string; authMethod?: string }>(input: {
  /** Worktree's Claude account pin; null/undefined = inherit global. */
  pinnedAccountId: string | null | undefined
  /** Globally active account for the worktree's runtime. */
  activeAccountId: string | null
  accounts: readonly A[]
}): WorktreeClaudeAccountResolution<A> {
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
  if (pinnedAccount.authMethod === 'custom-endpoint') {
    return { kind: 'pinned-endpoint', account: pinnedAccount }
  }
  return { kind: 'pinned', account: pinnedAccount }
}

/**
 * Decides whose usage the Claude meters display: the globally active account,
 * or the managed account the focused worktree is pinned to.
 */
export function resolveClaudeUsageAccountScope(
  input: ClaudeUsageAccountScopeInput
): ClaudeUsageAccountScope {
  // Why: undefined means the setting was never persisted; the feature defaults on.
  if (input.showWorktreeAccountUsage === false) {
    return { kind: 'global', limits: input.activeAccountLimits }
  }
  const resolution = resolveWorktreeClaudeAccount({
    pinnedAccountId: input.focusedWorktreeClaudeAccountId,
    activeAccountId: input.activeClaudeAccountId,
    accounts: input.accounts
  })
  if (resolution.kind === 'global') {
    return { kind: 'global', limits: input.activeAccountLimits }
  }
  if (resolution.kind === 'pinned-endpoint') {
    // Why: no usage API exists for the endpoint; a worktree scope with null
    // limits would leave the meters on the pending pulse forever.
    return {
      kind: 'worktree-custom-endpoint',
      accountId: resolution.account.id,
      email: resolution.account.email
    }
  }
  const pinnedId = resolution.account.id
  if (pinnedId === input.activeClaudeAccountId) {
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
  return {
    kind: 'worktree',
    accountId: pinnedId,
    email: resolution.account.email,
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

/** Terminal placeholder for pinned custom-endpoint accounts: renders the
 *  no-usage dash instead of the pending pulse. */
export function createCustomEndpointClaudeLimits(): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 0,
    error: null,
    status: 'unavailable'
  }
}
