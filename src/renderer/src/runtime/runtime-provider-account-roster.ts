import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

const ROSTER_TIMEOUT_MS = 15_000

/** Read the Claude roster of whichever host owns the accounts right now.
 *
 *  Why routed: every picker that offers an account has to offer the accounts of
 *  the machine that will run the agent. Calling the local preload directly hands
 *  a desktop its own roster while a server is active, so the user picks an
 *  account id that host has never heard of.
 */
export async function listClaudeAccountsForActiveHost(
  settings: { activeRuntimeEnvironmentId?: string | null } | null | undefined
): Promise<ClaudeRateLimitAccountsState> {
  const target = getActiveRuntimeTarget({
    activeRuntimeEnvironmentId: settings?.activeRuntimeEnvironmentId ?? null
  })
  if (target.kind === 'environment') {
    const response = await callRuntimeRpc<{ claude: ClaudeRateLimitAccountsState }>(
      target,
      'accounts.list',
      { refreshUsage: false },
      { timeoutMs: ROSTER_TIMEOUT_MS }
    )
    return response.claude
  }
  return (await window.api.claudeAccounts.list()) as ClaudeRateLimitAccountsState
}
