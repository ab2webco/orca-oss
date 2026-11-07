import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { capabilityKinds } from '../../shared/plugins/plugin-capabilities'
import type { PluginManifest } from '../../shared/plugins/plugin-manifest'

export const DEV_SHARED_VAULT_PLUGINS_ENV = 'ORCA_DEV_SHARED_VAULT_PLUGINS'

export const DEV_SHARED_VAULT_WORKER_BLOCK_REASON = `Not started: this dev Orca's claude-accounts folder is another install's account vault, and a plugin that can run processes may rewrite those accounts' settings.json. Set ${DEV_SHARED_VAULT_PLUGINS_ENV}=1 to run it anyway.`

/** True when <userData>/claude-accounts resolves (e.g. through a symlink) outside userData. */
export function isClaudeVaultOutsideUserData(userDataPath: string): boolean {
  let ownRoot: string
  let accountsRoot: string
  try {
    ownRoot = realpathSync(userDataPath)
    accountsRoot = realpathSync(join(userDataPath, 'claude-accounts'))
  } catch {
    return false
  }
  const path = relative(ownRoot, accountsRoot)
  return path.startsWith('..') || isAbsolute(path)
}

/**
 * Why: a plugin's spawned child escapes the worker's --permission sandbox and writes hook paths
 * into every vault under ORCA_USER_DATA_PATH/claude-accounts; through a linked vault that is
 * the installed Orca's real accounts (ORCA-1131). Packaged and E2E builds are never gated.
 */
export function resolveDevSharedVaultWorkerBlockReason(options: {
  isPackaged: boolean
  isE2E: boolean
  userDataPath: string
  env: NodeJS.ProcessEnv
}): string | null {
  if (options.isPackaged || options.isE2E || options.env[DEV_SHARED_VAULT_PLUGINS_ENV] === '1') {
    return null
  }
  return isClaudeVaultOutsideUserData(options.userDataPath)
    ? DEV_SHARED_VAULT_WORKER_BLOCK_REASON
    : null
}

export function spawnCapableWorkerBlockReason(
  manifest: PluginManifest | undefined,
  options: { getSpawnCapableWorkerBlockReason?: () => string | null }
): string | null {
  if (!manifest || !capabilityKinds(manifest.capabilities).includes('process:spawn')) {
    return null
  }
  return options.getSpawnCapableWorkerBlockReason?.() ?? null
}
