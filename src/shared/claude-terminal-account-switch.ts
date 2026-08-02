/**
 * Contract for the atomic in-place Claude account switch owned by the runtime
 * that holds the PTY. Renderer, CLI, self-switch and the bundled skill are
 * adapters over `accounts.switchClaudeTerminal`; none of them may drive the
 * Ctrl+C / write / verify sequence themselves.
 */

export const CLAUDE_TERMINAL_ACCOUNT_SWITCH_STATES = [
  'preflighting',
  'stopping-source',
  'launching-target',
  'verifying',
  'committed',
  'rolling-back',
  'rolled-back',
  'rollback-failed'
] as const

export type ClaudeTerminalAccountSwitchState =
  (typeof CLAUDE_TERMINAL_ACCOUNT_SWITCH_STATES)[number]

/** States after which no further transition can happen for an operation id. */
export const CLAUDE_TERMINAL_ACCOUNT_SWITCH_TERMINAL_STATES = [
  'committed',
  'rolled-back',
  'rollback-failed'
] as const satisfies readonly ClaudeTerminalAccountSwitchState[]

export function isTerminalClaudeAccountSwitchState(
  state: ClaudeTerminalAccountSwitchState
): boolean {
  return (
    CLAUDE_TERMINAL_ACCOUNT_SWITCH_TERMINAL_STATES as readonly ClaudeTerminalAccountSwitchState[]
  ).includes(state)
}

export type ClaudeTerminalAccountSwitchFailureReason =
  /** The runtime that owns this PTY has no account-switch services attached (headless `orca serve`). */
  | 'runtime-unavailable'
  | 'terminal-not-found'
  /** WSL, SSH or otherwise cross-host: auth and transcript semantics are not shared. */
  | 'unsupported-runtime'
  | 'target-not-found'
  | 'target-ambiguous'
  /** Custom-endpoint accounts own the failover path, not the managed→managed switch. */
  | 'target-unsupported-auth'
  | 'target-auth-invalid'
  | 'target-already-active'
  /** The PTY is not attributed to a managed Claude account this runtime can release. */
  | 'source-unknown'
  | 'source-mismatch'
  /** No trusted persisted launch configuration: argv would have to be guessed. */
  | 'missing-launch-config'
  /** No Claude provider session id observed for this pane, so nothing to resume. */
  | 'missing-session'
  | 'transcript-unavailable'
  | 'concurrent'
  | 'prepare-failed'
  /** Self-switch only: the invoking tool never gave the agent its foreground back. */
  | 'source-busy'
  | 'source-stop-failed'
  | 'launch-command-unbuildable'
  | 'launch-write-failed'
  | 'foreground-timeout'
  /** Claude came back with a different (or no) provider session id. */
  | 'session-mismatch'
  | 'commit-failed'

export type ClaudeTerminalAccountSwitchTarget =
  | { kind: 'handle'; terminal: string }
  | { kind: 'pty'; ptyId: string }

export type ClaudeTerminalAccountSwitchRequest = {
  target: ClaudeTerminalAccountSwitchTarget
  targetAccountId: string
  /**
   * The agent running in this very terminal asked for the switch, so its own
   * tool subprocess sits in the foreground process group the interrupt will
   * hit. The runtime waits for that subprocess to exit before stopping the
   * agent; every other adapter drives a terminal it is not running inside.
   */
  selfSwitch?: boolean
}

/**
 * The one prompt the runtime injects after a verified resume. Stopping the
 * source agent truncates whatever turn it was on, so the resumed session is
 * nudged exactly once — no adapter writes its own wording.
 */
export function buildClaudeAccountSwitchContinuationPrompt(target: string): string {
  return `Account switched to ${target}; continue where you left off.`
}

/** Returned before any destructive work so a dying caller cannot cancel the operation. */
export type ClaudeTerminalAccountSwitchAcceptance = {
  operationId: string
  state: ClaudeTerminalAccountSwitchState
  terminal: string
  ptyId: string
  sourceAccountId: string
  targetAccountId: string
  sessionId: string
}

export type ClaudeTerminalAccountSwitchFailure = {
  reason: ClaudeTerminalAccountSwitchFailureReason
  message: string
  /** Session id Claude actually reported, when it did not match the captured one. */
  observedSessionId?: string
  /** Terminal/session already holding the target account's global claim (ORCA-113). */
  blockingTerminal?: string
}

/** Explicit manual-recovery context for `rollback-failed`; never present on success. */
export type ClaudeTerminalAccountSwitchRecovery = {
  accountId: string
  sessionId: string
  configDir?: string
  terminal: string
  ptyId: string
}

export type ClaudeTerminalAccountSwitchResult = {
  operationId: string
  state: ClaudeTerminalAccountSwitchState
  terminal: string
  ptyId: string
  sourceAccountId: string | null
  targetAccountId: string
  sessionId: string | null
  /** 0 when both universes already share Orca's transcript store. */
  transcriptCopiedFileCount?: number
  continuationDelivered?: boolean
  failure?: ClaudeTerminalAccountSwitchFailure
  recovery?: ClaudeTerminalAccountSwitchRecovery
}

export function isClaudeTerminalAccountSwitchCommitted(
  result: ClaudeTerminalAccountSwitchResult
): boolean {
  return result.state === 'committed' && result.failure === undefined
}

const FAILURE_MESSAGES: Record<ClaudeTerminalAccountSwitchFailureReason, string> = {
  'runtime-unavailable': 'This Orca runtime cannot switch Claude accounts for a terminal.',
  'terminal-not-found': 'That terminal is not live on this runtime.',
  'unsupported-runtime':
    'Account switching runs on the runtime that owns the terminal; WSL and SSH-owned terminals are not supported yet.',
  'target-not-found': 'No managed Claude account matches that selector.',
  'target-ambiguous': 'That selector matches more than one managed Claude account.',
  'target-unsupported-auth':
    'That account runs on a custom endpoint; use the failover path instead of a managed account switch.',
  'target-auth-invalid': 'The selected account is not authenticated in its own Orca vault.',
  'target-already-active': 'This terminal is already running on that account.',
  'source-unknown': 'Orca does not know which managed Claude account owns this terminal.',
  'source-mismatch': 'This terminal changed accounts while the switch was being prepared.',
  'missing-launch-config':
    'Orca has no recorded launch command for this Claude process, so it will not relaunch it with guessed flags.',
  'missing-session':
    'No Claude session was observed in this terminal, so there is nothing to resume.',
  'transcript-unavailable':
    'The session transcript could not be made readable from the selected account.',
  concurrent: 'Another account switch is already running for this terminal.',
  'prepare-failed': 'Could not prepare the selected account for this terminal.',
  'source-busy':
    'The tool call that asked for the switch is still holding this terminal, so Orca did not interrupt the agent.',
  'source-stop-failed': 'The running agent did not exit, so Orca left the terminal untouched.',
  'launch-command-unbuildable': 'Could not build a resume command for the switched session.',
  'launch-write-failed': 'The terminal did not accept the resume command after switching accounts.',
  'foreground-timeout': 'The resumed agent did not take over the terminal in time.',
  'session-mismatch':
    'The resumed agent reported a different session, so Orca rolled the switch back.',
  'commit-failed': 'The resumed terminal could not be assigned to the selected account.'
}

export function describeClaudeTerminalAccountSwitchFailure(
  failure: ClaudeTerminalAccountSwitchFailure
): string {
  const base = failure.message || FAILURE_MESSAGES[failure.reason]
  if (failure.reason === 'session-mismatch' && failure.observedSessionId) {
    return `${base} (observed session ${failure.observedSessionId})`
  }
  if (failure.blockingTerminal) {
    return `${base} (held by ${failure.blockingTerminal})`
  }
  return base
}

/** Manual steps for a `rollback-failed` terminal, in one line an agent can act on. */
export function describeClaudeTerminalAccountSwitchRecovery(
  recovery: ClaudeTerminalAccountSwitchRecovery
): string {
  return (
    `Recovery: relaunch account ${recovery.accountId} in ${recovery.terminal} and resume session ` +
    `${recovery.sessionId}${recovery.configDir ? ` with CLAUDE_CONFIG_DIR=${recovery.configDir}` : ''}`
  )
}

export function claudeTerminalAccountSwitchFailureMessage(
  reason: ClaudeTerminalAccountSwitchFailureReason
): string {
  return FAILURE_MESSAGES[reason]
}
