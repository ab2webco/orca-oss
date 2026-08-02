import type { ClaudeManagedAccountSummary } from '../../../shared/types'
import {
  describeClaudeTerminalAccountSwitchFailure,
  type ClaudeTerminalAccountSwitchFailureReason,
  type ClaudeTerminalAccountSwitchResult
} from '../../../shared/claude-terminal-account-switch'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import type { AgentRateLimitFailoverMode } from '@/lib/agent-rate-limit-failover'

export type InPlaceManagedClaudeSwitchResult =
  | { ok: true; switched: AgentRateLimitFailoverMode }
  /** `restored` reports whether the original agent is running again; absent when nothing was stopped. */
  | {
      ok: false
      reason: 'unhealthy' | 'stop-failed' | 'failed'
      message: string
      restored?: boolean
    }

// Why: the runtime holds the response open for the terminal result, so this must
// outlast the switch's own verification window rather than racing it.
const SWITCH_AWAIT_MS = 150_000
const SWITCH_RPC_TIMEOUT_MS = 180_000

/**
 * Refusals that mean "this pane cannot be switched in place at all" — not that
 * the switch was attempted and failed. The caller falls back to a fresh tab for
 * these, exactly as it did when main could not prove a healthy idle shell.
 */
const NOT_SWITCHABLE_IN_PLACE: ReadonlySet<ClaudeTerminalAccountSwitchFailureReason> = new Set([
  'runtime-unavailable',
  'terminal-not-found',
  'unsupported-runtime',
  'source-unknown',
  'missing-launch-config',
  'missing-session',
  'concurrent'
])

type SwitchResponse = {
  accepted: boolean
  result: ClaudeTerminalAccountSwitchResult
}

/**
 * Asks the runtime that owns the PTY to switch this terminal's Claude account.
 *
 * Everything that used to live here — Ctrl+C, the CLAUDE_CONFIG_DIR export, the
 * resume write, the "is claude in the foreground" check, the binding commit and
 * the rollback — now runs inside that runtime as one transaction. It is the only
 * side that can verify the resumed provider session id is the SAME one, rebuild
 * the exact recorded argv, and keep going after this caller goes away.
 */
export async function runInPlaceManagedClaudeAccountSwitch(args: {
  ptyId: string
  targetAccount: ClaudeManagedAccountSummary
}): Promise<InPlaceManagedClaudeSwitchResult> {
  const environmentId = getRemoteRuntimePtyEnvironmentId(args.ptyId)
  // Why the PTY's own runtime: auth vaults, transcripts and hook rows all live
  // where the shell runs; driving it from here would touch the wrong host.
  const target = environmentId
    ? ({ kind: 'environment', environmentId } as const)
    : ({ kind: 'local' } as const)

  let response: SwitchResponse
  try {
    response = await callRuntimeRpc<SwitchResponse>(
      target,
      'accounts.switchClaudeTerminal',
      {
        ptyId: args.ptyId,
        targetAccountId: args.targetAccount.id,
        awaitMs: SWITCH_AWAIT_MS
      },
      { timeoutMs: SWITCH_RPC_TIMEOUT_MS }
    )
  } catch {
    // A transport failure says nothing about the operation, which may already be
    // running detached — so never claim the original agent was restored.
    return {
      ok: false,
      reason: 'failed',
      message: translate(
        'auto.lib.agentRateLimitAccountSwitch.switchRequestFailed',
        'Orca could not reach the runtime that owns this terminal to switch accounts.'
      )
    }
  }

  const { result } = response
  if (result.state === 'committed' && !result.failure) {
    return { ok: true, switched: result.continuationDelivered ? 'resumed' : 'launched' }
  }
  if (result.failure && NOT_SWITCHABLE_IN_PLACE.has(result.failure.reason)) {
    return { ok: false, reason: 'unhealthy', message: '' }
  }
  if (result.failure?.reason === 'source-stop-failed') {
    // Why its own reason: the agent is still running and owns the terminal, so
    // the auto-switch runner must back off rather than describe a lost session.
    return {
      ok: false,
      reason: 'stop-failed',
      message: describeClaudeTerminalAccountSwitchFailure(result.failure)
    }
  }
  return {
    ok: false,
    reason: 'failed',
    message: result.failure
      ? describeClaudeTerminalAccountSwitchFailure(result.failure)
      : translate(
          'auto.lib.agentRateLimitAccountSwitch.switchUnfinished',
          'The account switch did not finish; check this terminal before continuing.'
        ),
    restored: result.state === 'rolled-back'
  }
}
