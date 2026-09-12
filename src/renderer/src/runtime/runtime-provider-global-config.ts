import type { GlobalSettings } from '../../../shared/global-settings-types'
import type {
  GlobalConfigSyncInventory,
  GlobalConfigSyncSelection
} from '../../../shared/global-config-sync'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'
import { REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS } from './runtime-provider-accounts-client'

type OwnerSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined

// Why rewritten rather than surfaced raw: an older server answers method_not_found
// with the method name, which reads as a crash instead of as "update the server".
function rethrowOutdatedHost(error: unknown): never {
  if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
    throw new Error(
      'This Orca server is too old to sync global config from here. Update the server and try again.'
    )
  }
  throw error
}

/** What the owner offers as the seed source: its own MCP servers, skills and hooks.
 *
 *  Why it routes with the writes below and not just the writes: the seeding runs
 *  on the owner and resolves these by name, so a list picked from this desktop
 *  would name servers the server does not have and seed nothing.
 */
export async function previewGlobalConfigForProviderAccounts(
  settings: OwnerSettings
): Promise<GlobalConfigSyncInventory> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    return await callRuntimeRpc<GlobalConfigSyncInventory>(
      target,
      'accounts.previewGlobalConfig',
      undefined,
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    ).catch(rethrowOutdatedHost)
  }
  return await window.api.claudeAccounts.previewGlobalConfig()
}

/** Seed the selected global config into one account's vault, on its owner. */
export async function syncGlobalConfigForProviderAccount(
  settings: OwnerSettings,
  args: { accountId: string; selection?: GlobalConfigSyncSelection }
): Promise<void> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    await callRuntimeRpc(target, 'accounts.syncGlobalConfigForAccount', args, {
      timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS
    }).catch(rethrowOutdatedHost)
    return
  }
  await window.api.claudeAccounts.syncGlobalConfigForAccount(args)
}

/** Seed every managed account on the owner. Returns how many vaults it processed. */
export async function resyncGlobalConfigForProviderAccounts(
  settings: OwnerSettings,
  args?: { selection?: GlobalConfigSyncSelection }
): Promise<number> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    const result = await callRuntimeRpc<{ processed: number }>(
      target,
      'accounts.resyncGlobalConfig',
      args ?? {},
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    ).catch(rethrowOutdatedHost)
    return result.processed
  }
  return await window.api.claudeAccounts.resyncGlobalConfig(args)
}

/** Drop the inherited global config from one account's vault, on its owner. */
export async function clearGlobalConfigForProviderAccount(
  settings: OwnerSettings,
  accountId: string
): Promise<void> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    await callRuntimeRpc(
      target,
      'accounts.clearGlobalConfigForAccount',
      { accountId },
      { timeoutMs: REMOTE_ACCOUNT_MUTATION_TIMEOUT_MS }
    ).catch(rethrowOutdatedHost)
    return
  }
  await window.api.claudeAccounts.clearGlobalConfigForAccount({ accountId })
}
