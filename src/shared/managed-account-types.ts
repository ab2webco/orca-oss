import type { ClaudeTerminalSwitchReadiness } from './claude-terminal-account-switch'

export type CodexManagedAccount = {
  id: string
  email: string
  managedHomePath: string
  managedHomeRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxHomePath?: string | null
  providerAccountId?: string | null
  workspaceLabel?: string | null
  workspaceAccountId?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

export type CodexManagedAccountSummary = {
  id: string
  email: string
  managedHomeRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  providerAccountId?: string | null
  workspaceLabel?: string | null
  workspaceAccountId?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

/** Live, read-only identity of the user's real ~/.codex used by the
 *  system-default (activeAccountId:null) Codex account. Orca reads this to
 *  display and attribute the system default; it never writes ~/.codex. */
export type CodexSystemDefaultIdentity = {
  /** True when ~/.codex/auth.json exists (signed in via a token file). */
  hasAuth: boolean
  /** 'oauth' = ChatGPT sign-in with an id token (has ChatGPT usage);
   *  'api-key' = env-key/custom provider (no ChatGPT usage);
   *  'none' = signed out or identity could not be resolved. */
  authKind: 'oauth' | 'api-key' | 'none'
  email: string | null
  providerAccountId: string | null
  workspaceLabel: string | null
}

export type CodexRateLimitAccountsState = {
  accounts: CodexManagedAccountSummary[]
  activeAccountId: string | null
  activeAccountIdsByRuntime?: CodexManagedAccountRuntimeSelection
  /** Resolved identity of the host system-default (real ~/.codex) account.
   *  Omitted for runtimes where it is not resolved (e.g. per-distro WSL). */
  systemDefault?: CodexSystemDefaultIdentity
}

export type CodexManagedAccountRuntimeSelection = {
  host: string | null
  wsl: Record<string, string | null>
}

export type ClaudeManagedAccountAuthMethod = 'subscription-oauth' | 'custom-endpoint' | 'unknown'

export type ClaudeManagedAccount = {
  id: string
  email: string
  managedAuthPath: string
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxAuthPath?: string | null
  authMethod: ClaudeManagedAccountAuthMethod
  organizationUuid?: string | null
  organizationName?: string | null
  /** Display metadata for custom-endpoint accounts. The endpoint token is NEVER
   *  stored here — it lives only in the managed dir's settings.json (mode 600). */
  endpointLabel?: string | null
  endpointBaseUrl?: string | null
  endpointModel?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

export type ClaudeManagedAccountSummary = {
  id: string
  email: string
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  authMethod: ClaudeManagedAccountAuthMethod
  organizationUuid?: string | null
  organizationName?: string | null
  endpointLabel?: string | null
  endpointBaseUrl?: string | null
  endpointModel?: string | null
  createdAt: number
  updatedAt: number
  lastAuthenticatedAt: number
}

export type ClaudeLivePtyAccountBinding = {
  sessionId: string
  accountId: string
}

/** A PTY whose CODEX_HOME was pinned by an explicit `--codex-account` launch. */
export type CodexDirectedPtyAccountBinding = {
  sessionId: string
  accountId: string
}

/** Managed account backing a live Claude PTY, from main's live-pty gate.
 *  injected = per-worktree pinned universe; shared = global ~/.claude auth. */
export type ClaudeLivePtyAccountInfo = {
  accountId: string | null
  injected: boolean
}

/** Why unknown is never spelled as a null accountId: "runs on this account",
 *  "owns no managed account" and "the runtime does not know" are three different
 *  answers, and collapsing the last two is what let an agent report the global
 *  `active` selection as its own pane's account (ORCA-175, ORCA-190). */
export type ClaudeTerminalAccountUnknownReason =
  /** No live pane resolved from the handle — stale, closed, or asleep (ORCA-186). */
  | 'pane-unresolved'
  /** The pane resolved, but this runtime holds no Claude binding for its PTY. */
  | 'no-claude-binding'
  /** A shared PTY restored from persistence whose owner is still unresolved. */
  | 'ownership-unresolved'
  /** WSL or SSH pane with no binding here: its Claude authenticates on that host. */
  | 'remote-host'
  /** CLI-side: the caller proved no pane of its own, so there is nothing to read. */
  | 'no-caller-terminal'
  /** CLI-side: the runtime could not be asked, or answered a shape this build
   *  does not recognize — typically a runtime older than this CLI. */
  | 'lookup-failed'

export type ClaudeTerminalAccountOwnership =
  | { state: 'account'; accountId: string; email: string | null; pinned: boolean }
  | { state: 'none' }
  | { state: 'unknown'; reason: ClaudeTerminalAccountUnknownReason }

/** Keys of `~/.claude/settings.json` that belong to the user rather than to the
 *  identity, and so are merged into a pinned account's isolated vault (ORCA-189). */
export type ClaudeVaultSettingInheritanceKey =
  | 'permissions'
  | 'attribution'
  | 'includeCoAuthoredBy'
  | 'skillOverrides'
  | 'agentPushNotifEnabled'
  | 'outputStyle'

/** `stale` is the state that matters: home defines the key, the vault carries a
 *  different value, so the session running now does not have what the user set. */
export type ClaudeVaultSettingInheritanceState =
  | 'inherited'
  | 'stale'
  | 'absent'
  /** Home defines it but it cannot load here — an `outputStyle` naming a style
   *  this vault has no file for. Inheriting it would show `Default ✔` silently. */
  | 'unresolved'

export type ClaudeVaultSettingInheritance = {
  key: ClaudeVaultSettingInheritanceKey
  state: ClaudeVaultSettingInheritanceState
}

/**
 * Why not-applicable is spelled out: a shared-home pane reads `~/.claude`
 * directly and already has every key, so reporting it as missing would be the
 * same silent-wrong-answer defect this exists to remove.
 *
 * Scope: this is the state of the *vault* right now, not a snapshot of what the
 * pane's CLI read at launch. Two panes pinned to the same account share one
 * vault, so a later launch re-merges it and an earlier pane will read
 * `inherited` for a key its own process never loaded. Relaunch is what makes a
 * key take effect either way.
 */
export type ClaudeVaultSettingsInheritanceReport =
  | { state: 'not-applicable'; reason: 'shared-home' | 'remote-runtime' | 'unknown-account' }
  | { state: 'vault'; accountId: string; keys: ClaudeVaultSettingInheritance[] }

/** Which managed Claude account one terminal runs on, from the same binding the
 *  switch's `commit` writes — so it cannot drift from the status-line chip. */
export type ClaudeTerminalAccountReport = {
  terminal: string | null
  ptyId: string | null
  ownership: ClaudeTerminalAccountOwnership
  /** Whether this pane could be account-switched right now, from the switch's own
   *  preflight. Absent from runtimes older than ORCA-187, which could not answer. */
  switchReadiness?: ClaudeTerminalSwitchReadiness
  /** Which of the user's home settings this pane's vault actually resolved.
   *  Absent from runtimes older than ORCA-189, which could not answer. */
  settingsInheritance?: ClaudeVaultSettingsInheritanceReport
}

export type ManagedPtyAccountOwner = {
  known: boolean
  accountId: string | null
  customEndpoint: boolean
}

export type ClaudeSessionFailoverCopyFailureReason =
  | 'invalid-session-id'
  | 'target-account-not-found'
  | 'source-account-not-found'
  | 'target-dir-unresolved'
  | 'source-dir-unresolved'
  | 'source-not-found'
  | 'copy-failed'

/** Outcome of copying a provider session transcript into a custom-endpoint
 *  account universe for last-resort rate-limit failover. */
export type ClaudeSessionFailoverCopyResult =
  | { ok: true; sessionId: string; copiedFileCount: number }
  | { ok: false; reason: ClaudeSessionFailoverCopyFailureReason }

export type ClaudeLiveSharedPtyAccountBinding = {
  sessionId: string
  accountId: string | null
  /** Only meaningful when accountId is null: true when the launch recorded that
   *  null itself (no managed account was selected). Absent in rows written before
   *  ORCA-190, whose null is genuinely unknown ownership and must keep blocking
   *  every account until the live process resolves it. */
  accountResolved?: boolean
}

export type ClaudeRateLimitAccountsState = {
  accounts: ClaudeManagedAccountSummary[]
  activeAccountId: string | null
  activeAccountIdsByRuntime?: ClaudeManagedAccountRuntimeSelection
  /** Live model label the active account's session last reported (e.g. "Opus 4.8"); null when unknown. */
  activeModel?: string | null
}

export type ClaudeManagedAccountRuntimeSelection = {
  host: string | null
  wsl: Record<string, string | null>
}
