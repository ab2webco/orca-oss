import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'
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

/** Edit variant of the draft: a blank token keeps the one already stored. */
export type ClaudeCustomEndpointAccountEdit = Omit<ClaudeCustomEndpointAccountDraft, 'token'> & {
  accountId: string
  token?: string | null
}

/** What the owner reports back for the edit dialog. Never the token — `hasToken`
 *  is the only thing the caller learns about the stored secret. */
export type ClaudeCustomEndpointAccountConfig = {
  label: string
  baseUrl: string
  model: string
  opusModel: string | null
  sonnetModel: string | null
  haikuModel: string | null
  subagentModel: string | null
  hasToken: boolean
}

// Why rewritten rather than surfaced raw: an older server answers `method_not_found`
// with the method name, which reads as a crash instead of as "update the server".
function rethrowOutdatedHost(error: unknown): never {
  if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
    throw new Error(
      'This Orca server is too old to edit a custom endpoint. Update the server and try again.'
    )
  }
  throw error
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

/** Read one custom endpoint's configuration from the host that owns the account.
 *
 *  Why it routes: the dialog pre-fills from this, so against a remote server the
 *  desktop's own endpoint would be shown as if it were the server's.
 */
export async function getClaudeCustomEndpointProviderConfig(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  accountId: string
): Promise<ClaudeCustomEndpointAccountConfig> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return await callRuntimeRpc<ClaudeCustomEndpointAccountConfig>(
      target,
      'accounts.getCustomEndpointConfig',
      { accountId },
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    ).catch(rethrowOutdatedHost)
  }
  return await window.api.claudeAccounts.getCustomEndpointConfig({ accountId })
}

/** Apply an endpoint edit on the account owner. Blank token keeps the stored one. */
export async function updateClaudeCustomEndpointProviderAccount(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  input: ClaudeCustomEndpointAccountEdit
): Promise<ClaudeRateLimitAccountsState> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return await callRuntimeRpc<ClaudeRateLimitAccountsState>(
      target,
      'accounts.updateCustomEndpoint',
      input,
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    ).catch(rethrowOutdatedHost)
  }
  return (await window.api.claudeAccounts.updateCustomEndpoint(
    input
  )) as ClaudeRateLimitAccountsState
}
