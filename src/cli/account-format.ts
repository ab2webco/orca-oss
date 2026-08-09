import type {
  ClaudeManagedAccountAuthMethod,
  ClaudeRateLimitAccountsState,
  ClaudeTerminalAccountReport,
  ClaudeTerminalAccountUnknownReason,
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
  /** Which account the pane runs on. `active` is the GLOBAL selection and never
   *  answers that question — reading it there is the ORCA-175 defect. */
  terminal: ClaudeTerminalAccountReport
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

export function buildAccountListReport(
  snapshot: RuntimeAccountsSnapshot,
  terminal: ClaudeTerminalAccountReport
): AccountListReport {
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
  return { accounts: [...claude, ...codex], terminal }
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

const UNKNOWN_TERMINAL_ACCOUNT_REASONS: Record<ClaudeTerminalAccountUnknownReason, string> = {
  'pane-unresolved': 'no live pane resolved for that handle (closed, asleep, or reminted)',
  'no-claude-binding': 'Orca holds no Claude account binding for this pane',
  'ownership-unresolved': 'this pane outlived a restart and its owner is not resolved yet',
  'remote-host': 'this pane runs on a WSL distro or SSH host that owns its own Claude auth',
  'no-caller-terminal':
    'this command is not running inside an Orca-managed terminal; pass --terminal <handle>',
  'lookup-failed': 'the runtime could not answer (it may be older than this CLI)'
}

// Why this leads the output: `active` is the global selection, and reading it as
// the answer to "which account is this terminal on" is the defect (ORCA-175).
function formatTerminalAccount(report: ClaudeTerminalAccountReport): string {
  const pane = report.terminal ? ` [${report.terminal}]` : ''
  const caution = '(`active` below is the global selection, not this terminal’s account.)'
  const { ownership } = report
  if (ownership.state === 'account') {
    const label = ownership.email ?? `id ${ownership.accountId}`
    const binding = ownership.pinned ? 'pinned to this pane' : "Orca's shared runtime auth"
    return `this terminal: ${label}  id ${ownership.accountId}  (${binding})${pane}\n${caution}`
  }
  if (ownership.state === 'none') {
    return `this terminal: no managed Claude account — it runs on the login in Orca's shared runtime${pane}\n${caution}`
  }
  return `this terminal: unknown — ${UNKNOWN_TERMINAL_ACCOUNT_REASONS[ownership.reason]} (${ownership.reason})${pane}\n${caution}`
}

export function formatAccountList(report: AccountListReport): string {
  const terminal = formatTerminalAccount(report.terminal)
  if (report.accounts.length === 0) {
    return `${terminal}\n\nNo managed accounts.`
  }
  const paneAccountId =
    report.terminal.ownership.state === 'account' ? report.terminal.ownership.accountId : null
  const accounts = report.accounts
    .map((entry) => {
      const kind = entry.authMethod === 'custom-endpoint' ? ' custom-endpoint' : ''
      const endpoint = entry.endpointLabel ? ` [${entry.endpointLabel}]` : ''
      const wsl = entry.runtime === 'wsl' ? ` wsl:${entry.wslDistro ?? 'default'}` : ''
      const active = entry.active ? '  active' : ''
      const pane =
        entry.provider === 'claude' && entry.id === paneAccountId ? '  <- this terminal' : ''
      return `${entry.provider}  ${entry.email}${endpoint}${kind}${wsl}  id ${entry.id}${active}${pane}\n  ${formatQuota(entry.quota)}`
    })
    .join('\n')
  return `${terminal}\n\n${accounts}`
}
