import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS } from './runtime-provider-accounts-client'

/** The typed values behind a custom endpoint: no host path, no browser step. */
export type ClaudeCustomEndpointAccountDraft = {
  label: string
  baseUrl: string
  token: string
  model?: string | null
  opusModel?: string | null
  sonnetModel?: string | null
  haikuModel?: string | null
  subagentModel?: string | null
}

/** Create a custom-endpoint Claude account on whichever host owns the accounts.
 *
 *  Why this add lane crosses to a remote runtime while the OAuth one does not:
 *  `claude login` binds a loopback callback on the account owner, which the
 *  caller's browser cannot reach, and the host-side capture reads a filesystem
 *  path a paired client must never choose. A custom endpoint is a label, a base
 *  URL and a token — values the user typed — so the owner can build it from the
 *  payload alone.
 *
 *  Why its own module rather than beside the other provider-account helpers:
 *  that file sits at the `max-lines` budget, and the ratchet says split rather
 *  than grandfather.
 */
export async function addClaudeCustomEndpointProviderAccount(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  input: ClaudeCustomEndpointAccountDraft
): Promise<ClaudeRateLimitAccountsState> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return callRuntimeRpc<ClaudeRateLimitAccountsState>(
      target,
      'accounts.addCustomEndpoint',
      input,
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    )
  }
  return (await window.api.claudeAccounts.addCustomEndpoint(input)) as ClaudeRateLimitAccountsState
}
