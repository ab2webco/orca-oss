import type { ClaudeRateLimitAccountsState, CodexRateLimitAccountsState } from '../../shared/types'
import type {
  ClaudeLivePtyAccountInfo,
  ClaudeSessionFailoverCopyResult,
  ManagedPtyAccountOwner
} from '../../shared/managed-account-types'
import type { ManagedClaudeRefreshChainAliasReport } from '../../shared/claude-refresh-chain-alias-report'
import type {
  ClaudeAccountWorktreeUsageReport,
  ClaudeWorktreeAccountReassignment
} from '../../shared/claude-account-worktree-usage'
import type {
  GlobalConfigSyncInventory,
  GlobalConfigSyncSelection
} from '../../shared/global-config-sync'
import type { CodexConfigSyncStatus } from '../../shared/codex-config-sync-types'
import type { GrokAccountStatus } from '../../shared/rate-limit-types'

export type CodexAccountsApi = {
  getLivePtyAccount: (args: { ptyId: string }) => Promise<ManagedPtyAccountOwner>
  list: () => Promise<CodexRateLimitAccountsState>
  add: (args?: {
    runtime?: 'host' | 'wsl'
    wslDistro?: string | null
  }) => Promise<CodexRateLimitAccountsState>
  reauthenticate: (args: { accountId: string }) => Promise<CodexRateLimitAccountsState>
  remove: (args: { accountId: string }) => Promise<CodexRateLimitAccountsState>
  select: (args: {
    accountId: string | null
    runtime?: 'host' | 'wsl'
    wslDistro?: string | null
  }) => Promise<CodexRateLimitAccountsState>
  /** Live PTYs whose baked CODEX_HOME still points at a deselected account. */
  listStalePanes: (args: { ptyIds: string[] }) => Promise<
    {
      ptyId: string
      launchAccountId: string | null
      activeAccountId: string | null
      /** Optional for compatibility with a pre-reason main process. */
      reason?: 'account-change' | 'home-route-change'
    }[]
  >
  /** The selection lane each PTY launched from, keyed by pty id; unrecorded panes are absent. */
  listRecordedPaneLanes: (args: { ptyIds: string[] }) => Promise<Record<string, string>>
  /** Drops launch records so a dismissed prompt stays dismissed across restarts. */
  forgetStalePanes: (args: { ptyIds: string[] }) => Promise<void>
}

export type ClaudeAccountsApi = {
  addCustomEndpoint: (args: {
    label: string
    baseUrl: string
    token: string
    model?: string | null
    opusModel?: string | null
    sonnetModel?: string | null
    haikuModel?: string | null
    subagentModel?: string | null
  }) => Promise<ClaudeRateLimitAccountsState>
  updateCustomEndpoint: (args: {
    accountId: string
    label: string
    baseUrl: string
    token?: string | null
    model?: string | null
    opusModel?: string | null
    sonnetModel?: string | null
    haikuModel?: string | null
    subagentModel?: string | null
  }) => Promise<ClaudeRateLimitAccountsState>
  getCustomEndpointConfig: (args: { accountId: string }) => Promise<{
    label: string
    baseUrl: string
    model: string
    opusModel: string | null
    sonnetModel: string | null
    haikuModel: string | null
    subagentModel: string | null
    hasToken: boolean
  }>
  /** Which saved accounts share a recorded refresh chain (quarantined by main; see ORCA-69). */
  getRefreshChainAliasReport: () => Promise<ManagedClaudeRefreshChainAliasReport>
  remove: (args: {
    accountId: string
    closeLiveTerminals?: boolean
    closeLiveTerminalAccountIds?: readonly string[]
    reassignPinnedTo?: string | null
  }) => Promise<ClaudeRateLimitAccountsState>
  countLiveTerminalsForAccount: (args: { accountId: string }) => Promise<number>
  worktreeUsageReport: (args: { accountId: string }) => Promise<ClaudeAccountWorktreeUsageReport>
  reassignWorktrees: (
    args: ClaudeWorktreeAccountReassignment
  ) => Promise<ClaudeRateLimitAccountsState>
  previewGlobalConfig: () => Promise<GlobalConfigSyncInventory>
  resyncGlobalConfig: (args?: { selection?: GlobalConfigSyncSelection }) => Promise<number>
  syncGlobalConfigForAccount: (args: {
    accountId: string
    selection?: GlobalConfigSyncSelection
  }) => Promise<void>
  clearGlobalConfigForAccount: (args: { accountId: string }) => Promise<void>
  getLivePtyAccount: (args: { ptyId: string }) => Promise<ClaudeLivePtyAccountInfo | null>
  copySessionForFailover: (args: {
    sessionId: string
    cwd: string
    targetAccountId: string
    sourceAccountId?: string | null
  }) => Promise<ClaudeSessionFailoverCopyResult>
  copySessionForFailBack: (args: {
    sessionId: string
    cwd: string
    sourceAccountId: string
    targetAccountId: string | null
  }) => Promise<ClaudeSessionFailoverCopyResult>
  copySessionForAccountSwitch: (args: {
    sessionId: string
    cwd: string
    targetAccountId: string
    sourceAccountId?: string | null
  }) => Promise<ClaudeSessionFailoverCopyResult>
  list: () => Promise<ClaudeRateLimitAccountsState>
  add: (args?: {
    runtime?: 'host' | 'wsl'
    wslDistro?: string | null
  }) => Promise<ClaudeRateLimitAccountsState>
  cancelPendingLogin: () => Promise<boolean>
  reauthenticate: (args: { accountId: string }) => Promise<ClaudeRateLimitAccountsState>
  select: (args: {
    accountId: string | null
    runtime?: 'host' | 'wsl'
    wslDistro?: string | null
  }) => Promise<ClaudeRateLimitAccountsState>
}

export type GrokAccountsApi = {
  getStatus: () => Promise<GrokAccountStatus>
}

export type MinimaxCredentialsApi = {
  getStatus: () => Promise<{ configured: boolean }>
  saveCookie: (cookie: string) => Promise<{ configured: boolean }>
  clearCookie: () => Promise<{ configured: boolean }>
}

export type CodexConfigSyncApi = {
  status: () => Promise<CodexConfigSyncStatus>
}
