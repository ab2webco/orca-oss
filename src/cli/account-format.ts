import type {
  ClaudeManagedAccountAuthMethod,
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../shared/types'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  ProviderRateLimitStatus,
  RateLimitState,
  RateLimitWindow
} from '../shared/rate-limit-types'

/** Wire shape of the `accounts.snapshot` / `accounts.list` RPC results. */
export type RuntimeAccountsSnapshot = {
  claude: ClaudeRateLimitAccountsState
  codex: CodexRateLimitAccountsState
  rateLimits: RateLimitState
}

export type AccountQuota = {
  status: ProviderRateLimitStatus
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
  fableWeekly?: RateLimitWindow | null
  monthly?: RateLimitWindow | null
  planType?: string | null
  updatedAt: number
  error: string | null
}

export type AccountListEntry = {
  provider: 'claude' | 'codex'
  id: string
  email: string
  active: boolean
  runtime: 'host' | 'wsl'
  wslDistro: string | null
  authMethod?: ClaudeManagedAccountAuthMethod
  endpointLabel?: string | null
  endpointModel?: string | null
  workspaceLabel?: string | null
  /** Null when no usage snapshot exists for this account (e.g. custom-endpoint
   *  Claude accounts have no usage API, or the cache has not been filled). */
  quota: AccountQuota | null
}

export type AccountListReport = {
  accounts: AccountListEntry[]
}

// Why: strip usageMetadata/buckets/credits — quota windows are what a caller
// needs to pick an account; the rest is desktop-status-bar plumbing.
function toQuota(limits: ProviderRateLimits | null): AccountQuota | null {
  if (!limits) {
    return null
  }
  return {
    status: limits.status,
    session: limits.session,
    weekly: limits.weekly,
    ...(limits.fableWeekly !== undefined ? { fableWeekly: limits.fableWeekly } : {}),
    ...(limits.monthly !== undefined ? { monthly: limits.monthly } : {}),
    ...(limits.planType !== undefined ? { planType: limits.planType } : {}),
    updatedAt: limits.updatedAt,
    error: limits.error
  }
}

function isActiveAccountId(
  accountId: string,
  state: Pick<ClaudeRateLimitAccountsState, 'activeAccountId' | 'activeAccountIdsByRuntime'>
): boolean {
  return (
    state.activeAccountId === accountId ||
    state.activeAccountIdsByRuntime?.host === accountId ||
    Object.values(state.activeAccountIdsByRuntime?.wsl ?? {}).includes(accountId)
  )
}

function findQuota(
  accountId: string,
  active: boolean,
  activeLimits: ProviderRateLimits | null,
  inactiveUsage: readonly InactiveAccountUsage[]
): AccountQuota | null {
  const cached = inactiveUsage.find((entry) => entry.accountId === accountId)
  if (cached?.rateLimits) {
    return toQuota(cached.rateLimits)
  }
  return active ? toQuota(activeLimits) : null
}

export function buildAccountListReport(snapshot: RuntimeAccountsSnapshot): AccountListReport {
  const claude = snapshot.claude.accounts.map((account): AccountListEntry => {
    const active = isActiveAccountId(account.id, snapshot.claude)
    return {
      provider: 'claude',
      id: account.id,
      email: account.email,
      active,
      runtime: account.managedAuthRuntime === 'wsl' ? 'wsl' : 'host',
      wslDistro: account.wslDistro ?? null,
      authMethod: account.authMethod,
      ...(account.endpointLabel !== undefined ? { endpointLabel: account.endpointLabel } : {}),
      ...(account.endpointModel !== undefined ? { endpointModel: account.endpointModel } : {}),
      quota: findQuota(
        account.id,
        active,
        snapshot.rateLimits.claude,
        snapshot.rateLimits.inactiveClaudeAccounts
      )
    }
  })
  const codex = snapshot.codex.accounts.map((account): AccountListEntry => {
    const active = isActiveAccountId(account.id, snapshot.codex)
    return {
      provider: 'codex',
      id: account.id,
      email: account.email,
      active,
      runtime: account.managedHomeRuntime === 'wsl' ? 'wsl' : 'host',
      wslDistro: account.wslDistro ?? null,
      ...(account.workspaceLabel !== undefined ? { workspaceLabel: account.workspaceLabel } : {}),
      quota: findQuota(
        account.id,
        active,
        snapshot.rateLimits.codex,
        snapshot.rateLimits.inactiveCodexAccounts
      )
    }
  })
  return { accounts: [...claude, ...codex] }
}

function formatWindow(label: string, window: RateLimitWindow | null | undefined): string | null {
  if (!window) {
    return null
  }
  const reset = window.resetDescription ? ` (resets ${window.resetDescription})` : ''
  return `${label} ${Math.round(window.usedPercent)}%${reset}`
}

function formatQuota(quota: AccountQuota | null): string {
  if (!quota) {
    return 'quota: unavailable'
  }
  const windows = [
    formatWindow('session', quota.session),
    formatWindow('weekly', quota.weekly),
    formatWindow('fable-weekly', quota.fableWeekly),
    formatWindow('monthly', quota.monthly)
  ].filter((entry): entry is string => entry !== null)
  if (windows.length === 0) {
    return quota.error ? `quota: ${quota.status} (${quota.error})` : `quota: ${quota.status}`
  }
  return windows.join(' · ')
}

export function formatAccountList(report: AccountListReport): string {
  if (report.accounts.length === 0) {
    return 'No managed accounts.'
  }
  return report.accounts
    .map((entry) => {
      const kind = entry.authMethod === 'custom-endpoint' ? ' custom-endpoint' : ''
      const endpoint = entry.endpointLabel ? ` [${entry.endpointLabel}]` : ''
      const wsl = entry.runtime === 'wsl' ? ` wsl:${entry.wslDistro ?? 'default'}` : ''
      const active = entry.active ? '  active' : ''
      return `${entry.provider}  ${entry.email}${endpoint}${kind}${wsl}  id ${entry.id}${active}\n  ${formatQuota(entry.quota)}`
    })
    .join('\n')
}
