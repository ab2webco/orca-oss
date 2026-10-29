import type { ClaudeRateLimitAccountsState, CodexRateLimitAccountsState } from './types'
import type { ClaudeManagedAccountAuthMethod } from './managed-account-types'
import type { ClaudeAccountAuthVerdict } from './claude-account-auth-verdict'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  ProviderRateLimitStatus,
  RateLimitState,
  RateLimitWindow
} from './rate-limit-types'

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
  /** Whether the credential still authenticates. Null when nothing has checked
   *  it — presence in this list never implies a working sign-in (ORCA-211). */
  auth?: ClaudeAccountAuthVerdict | null
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

/** Every managed Claude and Codex account with its cached quota, as `orca account list` shows it. */
export function accountListEntriesOf(snapshot: RuntimeAccountsSnapshot): AccountListEntry[] {
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
      ),
      auth:
        snapshot.rateLimits.claudeAccountAuth?.find(
          (verdict) => verdict.accountId === account.id
        ) ?? null
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
  return [...claude, ...codex]
}
