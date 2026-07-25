// Pure model for the sidebar's per-project usage row. Resolves whose usage a
// project shows — the account pinned to its worktrees when they agree, else the
// globally active account — reusing the same scope resolvers the status-bar
// meters use, so the sidebar can never disagree with the Usage popover.
import type { ProviderRateLimits, InactiveAccountUsage } from '../../../../shared/rate-limit-types'
import {
  resolveClaudeUsageAccountScope,
  type ClaudeUsageAccountRef
} from '../status-bar/claude-usage-account-scope'
import {
  resolveCodexUsageAccountScope,
  type CodexUsageAccountRef
} from '../status-bar/codex-usage-account-scope'

export type SidebarUsageEntry = {
  provider: 'claude' | 'codex'
  /** Account email/label whose usage this row shows, or null for the global account. */
  accountLabel: string | null
  /** null when the pinned account has no usage cached yet (renders pending). */
  limits: ProviderRateLimits | null
  isFetching: boolean
}

export type SidebarProjectUsageInput = {
  /** Claude account ids pinned to this project's worktrees (may be empty/mixed). */
  claudePinnedAccountIds: readonly (string | null | undefined)[]
  /** Codex account ids pinned to this project's worktrees. */
  codexPinnedAccountIds: readonly (string | null | undefined)[]
  showWorktreeAccountUsage: boolean | undefined
  claudeAccounts: readonly ClaudeUsageAccountRef[]
  codexAccounts: readonly CodexUsageAccountRef[]
  activeClaudeAccountId: string | null
  activeCodexAccountId: string | null
  claudeLimits: ProviderRateLimits | null
  codexLimits: ProviderRateLimits | null
  inactiveClaudeUsage: readonly InactiveAccountUsage[]
  inactiveCodexUsage: readonly InactiveAccountUsage[]
}

/**
 * A project shows a pinned account's usage only when every worktree that pins
 * one agrees; mixed pins fall back to the global account, since one number
 * cannot honestly represent two different accounts.
 */
export function resolveProjectPinnedAccountId(
  pinnedIds: readonly (string | null | undefined)[]
): string | null {
  const present = pinnedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (present.length === 0) {
    return null
  }
  const first = present[0]
  return present.every((id) => id === first) ? first : null
}

/** Builds the usage entries a project row renders (empty when nothing to show). */
export function buildSidebarProjectUsage(input: SidebarProjectUsageInput): SidebarUsageEntry[] {
  const entries: SidebarUsageEntry[] = []

  const claudeScope = resolveClaudeUsageAccountScope({
    showWorktreeAccountUsage: input.showWorktreeAccountUsage,
    focusedWorktreeClaudeAccountId: resolveProjectPinnedAccountId(input.claudePinnedAccountIds),
    activeClaudeAccountId: input.activeClaudeAccountId,
    accounts: input.claudeAccounts,
    activeAccountLimits: input.claudeLimits,
    inactiveAccountUsage: input.inactiveClaudeUsage
  })
  if (claudeScope.kind === 'worktree') {
    entries.push({
      provider: 'claude',
      accountLabel: claudeScope.email,
      limits: claudeScope.limits,
      isFetching: claudeScope.isFetching
    })
  } else if (claudeScope.kind === 'global' && claudeScope.limits) {
    entries.push({
      provider: 'claude',
      accountLabel: null,
      limits: claudeScope.limits,
      isFetching: false
    })
  }
  // Why: a pinned custom-endpoint (z.ai) account has no usage API at all, so it
  // contributes no row rather than a permanently blank meter.

  const codexScope = resolveCodexUsageAccountScope({
    showWorktreeAccountUsage: input.showWorktreeAccountUsage,
    focusedWorktreeCodexAccountId: resolveProjectPinnedAccountId(input.codexPinnedAccountIds),
    activeCodexAccountId: input.activeCodexAccountId,
    accounts: input.codexAccounts,
    activeAccountLimits: input.codexLimits,
    inactiveAccountUsage: input.inactiveCodexUsage
  })
  if (codexScope.kind === 'worktree') {
    entries.push({
      provider: 'codex',
      accountLabel: codexScope.email,
      limits: codexScope.limits,
      isFetching: codexScope.isFetching
    })
  } else if (codexScope.kind === 'global' && codexScope.limits) {
    entries.push({
      provider: 'codex',
      accountLabel: null,
      limits: codexScope.limits,
      isFetching: false
    })
  }

  return entries
}
