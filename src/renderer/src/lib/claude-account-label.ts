import type {
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../../shared/types'

/** Human label for a globally selected Claude account id. `null` means the
 *  worktree/global scope inherits the system's shared `~/.claude` auth. */
export function getClaudeAccountLabel(
  state: ClaudeRateLimitAccountsState,
  accountId: string | null | undefined
): string {
  if (accountId == null) {
    return 'System default'
  }
  return state.accounts.find((account) => account.id === accountId)?.email ?? 'Claude account'
}

/** Host portion of a custom-endpoint base URL (e.g. `api.z.ai`), used as a
 *  compact label when no explicit endpoint label was provided. */
export function getEndpointHostLabel(endpointBaseUrl: string | null | undefined): string {
  if (!endpointBaseUrl) {
    return ''
  }
  try {
    return new URL(endpointBaseUrl).host
  } catch {
    return endpointBaseUrl
  }
}

/** Best display label for a custom-endpoint account: the user-chosen endpoint
 *  label, then the endpoint host, then the account email as a last resort. */
export function getClaudeEndpointDisplayLabel(
  account: Pick<ClaudeManagedAccountSummary, 'email' | 'endpointLabel' | 'endpointBaseUrl'>
): string {
  return (
    account.endpointLabel?.trim() || getEndpointHostLabel(account.endpointBaseUrl) || account.email
  )
}
