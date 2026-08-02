import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import { buildClaudeInPlaceResumeCommand } from '../../shared/claude-in-place-resume-command'
import { buildAgentResumeStartupPlan } from '../../shared/tui-agent-startup'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import type {
  ClaudeTerminalAccountSwitchFailure,
  ClaudeTerminalAccountSwitchFailureReason,
  ClaudeTerminalAccountSwitchRequest,
  ClaudeTerminalAccountSwitchResult,
  ClaudeTerminalAccountSwitchState
} from '../../shared/claude-terminal-account-switch'
import { claudeTerminalAccountSwitchFailureMessage } from '../../shared/claude-terminal-account-switch'

/**
 * Immutable snapshot taken before anything is mutated. Every later step —
 * including rollback — reads argv, session id and ownership from here, never
 * from live process inspection or current settings defaults.
 */
export type ClaudeTerminalSwitchCapture = {
  operationId: string
  terminal: string
  ptyId: string
  paneKey: string | null
  sourceAccountId: string
  targetAccountId: string
  runtime: 'host' | 'wsl'
  wslDistro: string | null
  /** Worktree/folder cwd the transcript is filed under. */
  cwd: string
  /** Exact Claude provider session id that must come back after the relaunch. */
  sessionId: string
  launchConfig: SleepingAgentLaunchConfig
  platform: NodeJS.Platform
  /** Best known shell family before the source stops; `begin` supersedes it with proof. */
  shell: AgentStartupShell
  capturedAt: number
}

export type ClaudeTerminalSwitchCaptureOutcome =
  | { ok: true; capture: ClaudeTerminalSwitchCapture }
  | { ok: false; reason: ClaudeTerminalAccountSwitchFailureReason; message?: string }

export type ClaudeTerminalSwitchBeginOutcome =
  | { ok: true; configDir: string; reservationId: string; shell: AgentStartupShell }
  | {
      ok: false
      reason: ClaudeTerminalAccountSwitchFailureReason
      blockingTerminal?: string
    }

export type ClaudeTerminalSwitchSessionOutcome =
  | { ok: true }
  | {
      ok: false
      reason: 'foreground-timeout' | 'session-mismatch'
      observedSessionId?: string
    }

/**
 * I/O primitives. The state machine owns ordering and compensation; each port is
 * one effect, so the transaction is testable without a PTY, a vault or a hook.
 */
export type AtomicClaudeTerminalAccountSwitchPorts = {
  now(): number
  /** Reads runtime/PTY state; must not mutate bindings, reservations or the terminal. */
  capture(request: ClaudeTerminalAccountSwitchRequest): Promise<ClaudeTerminalSwitchCaptureOutcome>
  /** Proves the target vault exists and is authenticated without the legacy machine keychain. */
  validateTarget(
    capture: ClaudeTerminalSwitchCapture
  ): Promise<{ ok: true } | { ok: false; reason: ClaudeTerminalAccountSwitchFailureReason }>
  /** A linked shared transcript store is success with zero copies. */
  prepareTranscript(
    capture: ClaudeTerminalSwitchCapture
  ): Promise<
    { ok: true; copiedFileCount: number } | { ok: false; reason: 'transcript-unavailable' }
  >
  /** Ctrl+C the source Claude and wait for the shell to own the foreground again. */
  stopSource(capture: ClaudeTerminalSwitchCapture): Promise<boolean>
  /** Serializes this PTY, reserves the target account and releases the source binding. */
  begin(capture: ClaudeTerminalSwitchCapture): Promise<ClaudeTerminalSwitchBeginOutcome>
  writeLaunchCommand(args: {
    capture: ClaudeTerminalSwitchCapture
    command: string
  }): Promise<boolean>
  /** Fresh pane-scoped hook observation whose provider session id equals the captured one. */
  awaitExactSession(args: {
    capture: ClaudeTerminalSwitchCapture
    observedAfter: number
  }): Promise<ClaudeTerminalSwitchSessionOutcome>
  commit(args: { capture: ClaudeTerminalSwitchCapture; reservationId: string }): Promise<boolean>
  /** Best-effort teardown of a destination Claude that must not keep the pane. */
  stopDestination(capture: ClaudeTerminalSwitchCapture): Promise<void>
  abort(args: {
    capture: ClaudeTerminalSwitchCapture
    reservationId: string
  }): Promise<{ ok: true; configDir: string } | { ok: false }>
  deliverContinuation(args: {
    capture: ClaudeTerminalSwitchCapture
    prompt: string
  }): Promise<boolean>
  onState?(event: {
    operationId: string
    state: ClaudeTerminalAccountSwitchState
    capture?: ClaudeTerminalSwitchCapture
  }): void
}

export type BuildClaudeTerminalSwitchLaunchCommandResult =
  | { ok: true; command: string }
  | { ok: false; reason: 'missing-launch-config' | 'launch-command-unbuildable' }

/**
 * Rebuilds the launch line from the captured configuration only. No settings
 * defaults and no `cmdOverrides` are consulted: `launchConfig.agentCommand`
 * already carries the user's flags (including
 * `--dangerously-skip-permissions`), so reintroducing either source would
 * duplicate them or silently drop a custom command.
 *
 * `configDir` prefixes a CLAUDE_CONFIG_DIR export for the destination universe;
 * pass null when the shell already exports the universe being relaunched.
 */
export function buildClaudeTerminalSwitchLaunchCommand(args: {
  sessionId: string
  launchConfig: SleepingAgentLaunchConfig
  shell: AgentStartupShell
  platform: NodeJS.Platform
  configDir: string | null
}): BuildClaudeTerminalSwitchLaunchCommandResult {
  const agentCommand = args.launchConfig.agentCommand?.trim()
  if (!agentCommand) {
    return { ok: false, reason: 'missing-launch-config' }
  }
  const plan = buildAgentResumeStartupPlan({
    agent: 'claude',
    providerSession: { key: 'session_id', id: args.sessionId },
    cmdOverrides: {},
    platform: args.platform,
    shell: args.shell,
    agentCommand,
    agentArgs: args.launchConfig.agentArgs,
    agentEnv: args.launchConfig.agentEnv
  })
  if (!plan) {
    return { ok: false, reason: 'launch-command-unbuildable' }
  }
  return {
    ok: true,
    command: args.configDir
      ? buildClaudeInPlaceResumeCommand({
          configDir: args.configDir,
          resumeCommand: plan.launchCommand,
          shell: args.shell
        })
      : plan.launchCommand
  }
}

function failure(
  reason: ClaudeTerminalAccountSwitchFailureReason,
  extra: Omit<ClaudeTerminalAccountSwitchFailure, 'reason' | 'message'> & { message?: string } = {}
): ClaudeTerminalAccountSwitchFailure {
  const { message, ...rest } = extra
  return {
    reason,
    message: message ?? claudeTerminalAccountSwitchFailureMessage(reason),
    ...rest
  }
}

/**
 * Runs the whole switch as one transaction on the runtime that owns the PTY.
 *
 * Ordering rules that the tests pin:
 * - Target auth, transcript reachability and a trusted launch configuration are
 *   proven BEFORE the source is stopped, so a refused switch never touches the
 *   terminal or any binding.
 * - The reservation cannot precede the stop: `begin` only accepts a proven-idle
 *   shell. The preflight above is what keeps that stop from being speculative.
 * - Only a fresh hook observation carrying the exact captured session id
 *   commits. "Claude is in the foreground" is not verification.
 * - Every failure after the stop runs the compensating rollback, and a rollback
 *   that cannot re-verify the source session reports `rollback-failed` with
 *   recovery context instead of any kind of success.
 */
export async function runAtomicClaudeTerminalAccountSwitch(
  request: ClaudeTerminalAccountSwitchRequest,
  ports: AtomicClaudeTerminalAccountSwitchPorts
): Promise<ClaudeTerminalAccountSwitchResult> {
  let state: ClaudeTerminalAccountSwitchState = 'preflighting'
  let capture: ClaudeTerminalSwitchCapture | null = null
  const transition = (next: ClaudeTerminalAccountSwitchState): void => {
    state = next
    ports.onState?.({
      operationId: capture?.operationId ?? '',
      state: next,
      ...(capture ? { capture } : {})
    })
  }

  const captured = await ports.capture(request)
  if (!captured.ok) {
    return {
      operationId: '',
      state,
      terminal: request.target.kind === 'handle' ? request.target.terminal : '',
      ptyId: request.target.kind === 'pty' ? request.target.ptyId : '',
      sourceAccountId: null,
      targetAccountId: request.targetAccountId,
      sessionId: null,
      failure: failure(captured.reason, captured.message ? { message: captured.message } : {})
    }
  }
  capture = captured.capture

  const base = (
    nextState: ClaudeTerminalAccountSwitchState,
    extra: Partial<ClaudeTerminalAccountSwitchResult> = {}
  ): ClaudeTerminalAccountSwitchResult => ({
    operationId: capture!.operationId,
    state: nextState,
    terminal: capture!.terminal,
    ptyId: capture!.ptyId,
    sourceAccountId: capture!.sourceAccountId,
    targetAccountId: capture!.targetAccountId,
    sessionId: capture!.sessionId,
    ...extra
  })
  const refuse = (
    reason: ClaudeTerminalAccountSwitchFailureReason
  ): ClaudeTerminalAccountSwitchResult => base(state, { failure: failure(reason) })

  if (capture.sourceAccountId === capture.targetAccountId) {
    return refuse('target-already-active')
  }
  const target = await ports.validateTarget(capture)
  if (!target.ok) {
    return refuse(target.reason)
  }
  // Why here: refusing an untrusted launch configuration must happen before the
  // Ctrl+C, not after — otherwise the agent is dead and argv has to be guessed.
  if (!capture.launchConfig.agentCommand?.trim()) {
    return refuse('missing-launch-config')
  }
  const transcript = await ports.prepareTranscript(capture)
  if (!transcript.ok) {
    return refuse(transcript.reason)
  }

  /**
   * Puts the captured source session back in the same PTY and re-verifies it.
   * `configDir` is null only when the shell still exports the source universe
   * (a failure before `begin` swapped it).
   */
  const restoreSource = async (args: {
    configDir: string | null
    shell: AgentStartupShell
  }): Promise<boolean> => {
    const command = buildClaudeTerminalSwitchLaunchCommand({
      sessionId: capture!.sessionId,
      launchConfig: capture!.launchConfig,
      shell: args.shell,
      platform: capture!.platform,
      configDir: args.configDir
    })
    if (!command.ok) {
      return false
    }
    const observedAfter = ports.now()
    if (!(await ports.writeLaunchCommand({ capture: capture!, command: command.command }))) {
      return false
    }
    const restored = await ports.awaitExactSession({ capture: capture!, observedAfter })
    return restored.ok
  }

  const rollbackFailed = (
    cause: ClaudeTerminalAccountSwitchFailure,
    configDir?: string
  ): ClaudeTerminalAccountSwitchResult => {
    transition('rollback-failed')
    return base('rollback-failed', {
      failure: cause,
      recovery: {
        accountId: capture!.sourceAccountId,
        sessionId: capture!.sessionId,
        terminal: capture!.terminal,
        ptyId: capture!.ptyId,
        ...(configDir ? { configDir } : {})
      }
    })
  }

  transition('stopping-source')
  if (!(await ports.stopSource(capture))) {
    // Nothing was released or reserved yet, so the source agent still owns the PTY.
    return base('stopping-source', { failure: failure('source-stop-failed') })
  }

  const begun = await ports.begin(capture)
  if (!begun.ok) {
    transition('rolling-back')
    // The source binding survives a failed `begin`, so only its CLI must come
    // back — and the PTY still exports the source universe.
    const restored = await restoreSource({ configDir: null, shell: capture.shell })
    const cause = failure(
      begun.reason,
      begun.blockingTerminal ? { blockingTerminal: begun.blockingTerminal } : {}
    )
    if (!restored) {
      return rollbackFailed(cause)
    }
    transition('rolled-back')
    return base('rolled-back', { failure: cause })
  }

  /** Compensating transaction for every failure past `begin`. */
  const rollback = async (
    cause: ClaudeTerminalAccountSwitchFailure
  ): Promise<ClaudeTerminalAccountSwitchResult> => {
    transition('rolling-back')
    await ports.stopDestination(capture!)
    const aborted = await ports.abort({ capture: capture!, reservationId: begun.reservationId })
    if (!aborted.ok) {
      return rollbackFailed(cause)
    }
    if (!(await restoreSource({ configDir: aborted.configDir, shell: begun.shell }))) {
      return rollbackFailed(cause, aborted.configDir)
    }
    transition('rolled-back')
    return base('rolled-back', { failure: cause })
  }

  transition('launching-target')
  const launch = buildClaudeTerminalSwitchLaunchCommand({
    sessionId: capture.sessionId,
    launchConfig: capture.launchConfig,
    shell: begun.shell,
    platform: capture.platform,
    configDir: begun.configDir
  })
  if (!launch.ok) {
    return rollback(failure(launch.reason))
  }
  const observedAfter = ports.now()
  if (!(await ports.writeLaunchCommand({ capture, command: launch.command }))) {
    return rollback(failure('launch-write-failed'))
  }

  transition('verifying')
  const verified = await ports.awaitExactSession({ capture, observedAfter })
  if (!verified.ok) {
    return rollback(
      failure(
        verified.reason,
        verified.observedSessionId ? { observedSessionId: verified.observedSessionId } : {}
      )
    )
  }

  if (!(await ports.commit({ capture, reservationId: begun.reservationId }))) {
    return rollback(failure('commit-failed'))
  }

  transition('committed')
  const continuationDelivered = request.continuationPrompt
    ? await ports.deliverContinuation({ capture, prompt: request.continuationPrompt })
    : false
  return base('committed', {
    transcriptCopiedFileCount: transcript.copiedFileCount,
    continuationDelivered
  })
}
