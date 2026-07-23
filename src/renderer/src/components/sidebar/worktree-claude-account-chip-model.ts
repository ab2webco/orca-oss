import type { ClaudeRateLimitAccountsState } from '../../../../shared/types'
import { getClaudeEndpointDisplayLabel } from '@/lib/claude-account-label'
import { resolveWorktreeClaudeAccount } from '@/components/status-bar/claude-usage-account-scope'

type ClaudeAccountRoster = Pick<
  ClaudeRateLimitAccountsState,
  'accounts' | 'activeAccountId' | 'activeAccountIdsByRuntime'
>

/** Globally active Claude account id for a worktree's runtime. Mirrors the
 *  status-bar host selection, and picks the WSL selection when the worktree
 *  path resolves to a distro. */
export function getActiveClaudeAccountId(
  roster: ClaudeAccountRoster | null | undefined,
  wslDistro: string | null
): string | null {
  const selection = roster?.activeAccountIdsByRuntime
  if (!wslDistro) {
    return selection?.host ?? roster?.activeAccountId ?? null
  }
  return selection?.wsl?.[wslDistro] ?? null
}

export type WorktreeClaudeAccountChipModel = {
  label: string
  /** True when the account comes from the global selection, not the worktree pin. */
  inherited: boolean
  isEndpoint: boolean
}

/**
 * Resolves the compact chip content for a worktree row: the pinned account when
 * set and present, otherwise the globally active account (or the system default
 * when no managed account is active). Returns null only when there is nothing to
 * show — a dangling pin still falls back to the resolved global identity.
 */
export function buildWorktreeClaudeAccountChipModel(args: {
  pinnedAccountId: string | null | undefined
  wslDistro: string | null
  roster: ClaudeAccountRoster | null | undefined
  systemDefaultLabel: string
}): WorktreeClaudeAccountChipModel | null {
  // Why: the roster slice may be unset (before the app-scoped subscription
  // populates it, or in tests that don't mount it) — render no chip, never throw.
  if (!args.roster) {
    return null
  }
  const activeAccountId = getActiveClaudeAccountId(args.roster, args.wslDistro)
  const resolution = resolveWorktreeClaudeAccount({
    pinnedAccountId: args.pinnedAccountId,
    activeAccountId,
    accounts: args.roster.accounts
  })
  if (resolution.kind === 'pinned-endpoint') {
    return {
      label: getClaudeEndpointDisplayLabel(resolution.account),
      inherited: false,
      isEndpoint: true
    }
  }
  if (resolution.kind === 'pinned') {
    return { label: resolution.account.email, inherited: false, isEndpoint: false }
  }
  // Why: no globally active managed account means the shared ~/.claude auth is in use.
  if (!resolution.account) {
    return { label: args.systemDefaultLabel, inherited: true, isEndpoint: false }
  }
  return {
    label: resolution.account.email,
    inherited: true,
    isEndpoint: resolution.account.authMethod === 'custom-endpoint'
  }
}
