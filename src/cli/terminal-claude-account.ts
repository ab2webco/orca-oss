import type { ClaudeTerminalAccountOwnership, ClaudeTerminalAccountReport } from '../shared/types'
import type { RuntimeClient } from './runtime-client'
import { resolveCallerTerminalIdentity } from './caller-terminal-identity'

function unknown(
  reason: Extract<ClaudeTerminalAccountOwnership, { state: 'unknown' }>['reason'],
  terminal: string | null = null
): ClaudeTerminalAccountReport {
  return { terminal, ptyId: null, ownership: { state: 'unknown', reason } }
}

function isReport(value: unknown): value is ClaudeTerminalAccountReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const ownership = (value as { ownership?: unknown }).ownership
  if (!ownership || typeof ownership !== 'object') {
    return false
  }
  const state = (ownership as { state?: unknown }).state
  return state === 'account' || state === 'none' || state === 'unknown'
}

/**
 * Reads which managed Claude account a terminal runs on: the pane named by
 * `--terminal`, otherwise the caller's own proven pane.
 *
 * Never throws. `account list` is the safe cached path for scripted callers, so
 * a pane that cannot be resolved — or a runtime too old to answer — degrades to
 * an explicit unknown instead of failing the roster the caller asked for.
 */
export async function readTerminalClaudeAccount(args: {
  flags: Map<string, string | boolean>
  client: RuntimeClient
  env?: NodeJS.ProcessEnv
}): Promise<ClaudeTerminalAccountReport> {
  let terminal: string
  try {
    terminal = (
      await resolveCallerTerminalIdentity({
        flags: args.flags,
        client: args.client,
        flagName: 'terminal',
        ...(args.env ? { env: args.env } : {})
      })
    ).terminal
  } catch {
    return unknown('no-caller-terminal')
  }
  try {
    const response = await args.client.call<ClaudeTerminalAccountReport>(
      'accounts.terminalClaudeAccount',
      { terminal }
    )
    return isReport(response.result) ? response.result : unknown('lookup-failed', terminal)
  } catch {
    return unknown('lookup-failed', terminal)
  }
}
