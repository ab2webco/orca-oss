import type { HandlerContext } from '../dispatch'
import type { RuntimeAccountsSnapshot } from '../account-format'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getRequiredStringFlag } from '../flags'
import { resolveManagedAccountSelector } from '../account-selector'
import { resolveCallerTerminalIdentity } from '../caller-terminal-identity'
import {
  describeClaudeTerminalAccountSwitchFailure,
  describeClaudeTerminalAccountSwitchRecovery,
  isSettledClaudeTerminalAccountSwitchResult,
  isTerminalClaudeAccountSwitchState,
  type ClaudeTerminalAccountSwitchResult
} from '../../shared/claude-terminal-account-switch'

type ClaudeTerminalSwitchResponse = {
  accepted: boolean
  acceptance: { operationId: string; selfSwitch?: boolean } | null
  result: ClaudeTerminalAccountSwitchResult
}

// Why poll instead of holding the socket: a real switch runs far longer than any
// idle timer the transport is willing to keep open, and the operation outlives
// this process anyway. The ceiling covers a verify timeout (90 s) plus the
// rollback's own re-verification, with slack (ORCA-168).
const SWITCH_POLL_INTERVAL_MS = 1_000
const SWITCH_POLL_CEILING_MS = 300_000

async function pollClaudeTerminalSwitch(
  client: HandlerContext['client'],
  operationId: string,
  current: ClaudeTerminalAccountSwitchResult
): Promise<ClaudeTerminalAccountSwitchResult> {
  const deadline = Date.now() + SWITCH_POLL_CEILING_MS
  let latest = current
  // Why settled and not terminal-state: a refusal never leaves `preflighting`
  // (or `stopping-source`), so waiting for a terminal state turned an answer the
  // runtime had in milliseconds into the full ceiling — five minutes of silence
  // before printing `transcript-unavailable` (ORCA-172).
  while (!isSettledClaudeTerminalAccountSwitchResult(latest) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SWITCH_POLL_INTERVAL_MS))
    const status = await client.call<{ result: ClaudeTerminalAccountSwitchResult | null }>(
      'accounts.claudeTerminalSwitchStatus',
      { operationId }
    )
    // Why keep the last known result: the runtime prunes old operations, and a
    // dropped record must not erase what the caller already knows.
    latest = status.result.result ?? latest
  }
  return latest
}

function formatClaudeTerminalSwitch(response: ClaudeTerminalSwitchResponse): string {
  const { result } = response
  const lines = [
    `Terminal:  ${result.terminal || '(unresolved)'}`,
    `Account:   ${result.sourceAccountId ?? '(unknown)'} → ${result.targetAccountId}`,
    `Session:   ${result.sessionId ?? '(none)'}`,
    `State:     ${result.state}`
  ]
  if (result.operationId) {
    lines.push(`Operation: ${result.operationId}`)
  }
  if (typeof result.transcriptCopiedFileCount === 'number') {
    lines.push(
      result.transcriptCopiedFileCount === 0
        ? 'Transcript: already readable from the target account (no copy needed)'
        : `Transcript: copied ${result.transcriptCopiedFileCount} file(s) into the target account`
    )
  }
  if (result.recovery) {
    lines.push(describeClaudeTerminalAccountSwitchRecovery(result.recovery))
  }
  if (result.failure) {
    lines.push(describeClaudeTerminalAccountSwitchFailure(result.failure))
  }
  if (!isTerminalClaudeAccountSwitchState(result.state)) {
    // Why not an error: the runtime accepted the transaction and owns it from
    // here. A self-switching agent is answered before its own terminal is
    // interrupted, so the CLI exiting is part of the sequence, not a timeout.
    lines.push('Accepted: the switch keeps running in this terminal after this command exits.')
  }
  return lines.join('\n')
}

/**
 * Switches the caller's own terminal (or an explicitly named one) to another
 * managed Claude account. All of the work happens in the runtime that owns the
 * PTY; this only resolves identity, names the target account, and reports.
 */
export async function switchClaudeTerminalAccount(ctx: HandlerContext): Promise<void> {
  const { flags, client, json } = ctx
  const selector = getRequiredStringFlag(flags, 'to')
  const identity = await resolveCallerTerminalIdentity({ flags, client, flagName: 'terminal' })
  // Why the cached snapshot: resolving a name must not stall behind a forced
  // provider usage refresh, and this command changes nothing about quota.
  const snapshot = await client.call<RuntimeAccountsSnapshot>('accounts.snapshot')
  const targetAccountId = resolveManagedAccountSelector({
    flag: 'to',
    providerLabel: 'Claude',
    selector,
    accounts: snapshot.result.claude.accounts
  })
  const response = await client.call<ClaudeTerminalSwitchResponse>(
    'accounts.switchClaudeTerminal',
    {
      terminal: identity.terminal,
      ...(identity.paneKey ? { paneKey: identity.paneKey } : {}),
      ...(identity.launchToken ? { launchToken: identity.launchToken } : {}),
      targetAccountId,
      // Why 0: the runtime answers as soon as it owns the transaction, and the
      // outcome is polled below. Holding the response is what cost the last
      // release its operation id when the socket died mid-switch.
      awaitMs: 0
    }
  )
  const accepted = response.result
  // Why not polled: this command is the tool call the runtime is waiting to see
  // exit before it interrupts the agent, so staying alive here would deadlock
  // the very switch it is reporting.
  const result =
    accepted.acceptance && !accepted.acceptance.selfSwitch
      ? await pollClaudeTerminalSwitch(client, accepted.acceptance.operationId, accepted.result)
      : accepted.result
  if (result.failure) {
    // Why not printResult first: a second write would corrupt the JSON envelope.
    // The error carries the operation id so a detached switch stays traceable,
    // and the recovery context so it survives a caller that is already dying.
    throw new RuntimeClientError(
      `claude_terminal_switch_${result.failure.reason.replaceAll('-', '_')}`,
      `${describeClaudeTerminalAccountSwitchFailure(result.failure)}${
        result.operationId ? ` (operation ${result.operationId}, state ${result.state})` : ''
      }${result.recovery ? `. ${describeClaudeTerminalAccountSwitchRecovery(result.recovery)}` : ''}`
    )
  }
  printResult({ ...response, result: { ...accepted, result } }, json, formatClaudeTerminalSwitch)
}
