import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import type {
  ClaudeAccountWorktreeUsageReport,
  ClaudeWorktreeAccountReassignment
} from '../../../shared/claude-account-worktree-usage'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'

/**
 * What removing a Claude account would cost, and the move that clears the way.
 *
 * Why these two live together: between them they answer one question — which
 * worktrees pin this account and how many of its terminals are live, then where
 * those pins go instead. Both read state owned by the host that runs the agent,
 * and a server-hosted worktree can carry a pin now, so both must follow the
 * active runtime rather than assume the local one.
 */

/** Describe the worktrees and live terminals holding a Claude account.
 *
 *  Why routed: reporting an empty usage for a remote host was not a safe
 *  default — it told the user removing the account would cost nothing while its
 *  terminals were still running on the server.
 */
export async function getClaudeAccountWorktreeUsage(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  accountId: string
): Promise<ClaudeAccountWorktreeUsageReport> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return callRuntimeRpc<ClaudeAccountWorktreeUsageReport>(
      target,
      'accounts.claudeWorktreeUsage',
      { accountId }
    )
  }
  return window.api.claudeAccounts.worktreeUsageReport({ accountId })
}

/** Move or clear the pins naming an account, on whichever host owns them.
 *
 *  Why routed: this used to throw "only available on the local runtime", which
 *  made every account action that has to clear a pin first — including making
 *  another account the default — impossible while connected to a server.
 */
export async function reassignClaudeWorktreeAccounts(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  request: ClaudeWorktreeAccountReassignment
): Promise<ClaudeRateLimitAccountsState> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return callRuntimeRpc<ClaudeRateLimitAccountsState>(
      target,
      'accounts.reassignClaudeWorktrees',
      request
    )
  }
  return window.api.claudeAccounts.reassignWorktrees(request)
}
