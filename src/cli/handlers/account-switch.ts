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
  isTerminalClaudeAccountSwitchState,
  type ClaudeTerminalAccountSwitchResult
} from '../../shared/claude-terminal-account-switch'

type ClaudeTerminalSwitchResponse = {
  accepted: boolean
  acceptance: { operationId: string } | null
  result: ClaudeTerminalAccountSwitchResult
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
      targetAccountId
    }
  )
  const { result } = response.result
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
  printResult(response, json, formatClaudeTerminalSwitch)
}
