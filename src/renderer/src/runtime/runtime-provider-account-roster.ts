import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../shared/managed-account-types'
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
  return listClaudeAccountsForEnvironment(settings?.activeRuntimeEnvironmentId ?? null)
}

/** Read the Claude roster of one named host, rather than whichever is active.
 *
 *  Why this exists next to the active-host reader: the sidebar shows every host
 *  at once, so a menu opened on a row belonging to a server must offer THAT
 *  server's accounts — the app's active runtime is a different question and is
 *  often `null` while the row's owner is not. Keying the roster off the active
 *  runtime is why the assign menu listed this desktop's accounts on a
 *  server-owned worktree.
 */
export async function listClaudeAccountsForEnvironment(
  environmentId: string | null
): Promise<ClaudeRateLimitAccountsState> {
  const target = getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId })
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

/** The Codex sibling of the above, for the same reason: a picker must offer the
 *  accounts of the machine that will run the agent, not of this desktop. */
export async function listCodexAccountsForActiveHost(
  settings: { activeRuntimeEnvironmentId?: string | null } | null | undefined
): Promise<CodexRateLimitAccountsState> {
  return listCodexAccountsForEnvironment(settings?.activeRuntimeEnvironmentId ?? null)
}

/** The Codex sibling of {@link listClaudeAccountsForEnvironment}. */
export async function listCodexAccountsForEnvironment(
  environmentId: string | null
): Promise<CodexRateLimitAccountsState> {
  const target = getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId })
  if (target.kind === 'environment') {
    const response = await callRuntimeRpc<{ codex: CodexRateLimitAccountsState }>(
      target,
      'accounts.list',
      { refreshUsage: false },
      { timeoutMs: ROSTER_TIMEOUT_MS }
    )
    return response.codex
  }
  return (await window.api.codexAccounts.list()) as CodexRateLimitAccountsState
}
