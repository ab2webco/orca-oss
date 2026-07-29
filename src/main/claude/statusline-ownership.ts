/**
 * Detection and consented replacement of user-owned statusLine slots across every settings
 * universe: the shared ~/.claude home plus each managed account's vault.
 *
 * Why vaults too: vault creation clones the home settings.json, so a stale copy of the user's
 * personal statusLine can survive inside a vault and block the managed line for pinned
 * launches (including Agent Teams) while the home slot looks clean. `applyManagedStatusLine`
 * keeps its never-overwrite contract; this module is the explicit, user-consented path that
 * removes the user's key and lets the same install merge fill the slot.
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ClaudeStatusLineOwnership,
  ClaudeStatusLineReplaceResult,
  ClaudeStatusLineUniverseOwnership,
  ClaudeStatusLineUniverseState
} from '../../shared/agent-hook-types'
import type { ClaudeManagedAccount } from '../../shared/types'
import {
  isPlainObject,
  readHooksJson,
  writeHooksJson,
  type HooksConfig
} from '../agent-hooks/installer-utils'
import {
  readClaudeManagedAuthFile,
  writeClaudeManagedAuthFile
} from '../claude-accounts/managed-auth-path'
import { claudeHookService, type ClaudeHookService } from './hook-service'
import {
  getConfigPath,
  getStatusLineInstallMarkerPath,
  getStatusLineScriptFileName,
  getStatusLineSlotState
} from './hook-settings'

// Why a module-level source instead of threading the store through the IPC registration: the
// accounts list lives on the Store, which boots after the handlers register — the same pattern
// `configureClaudeStatusLineItemsSource` uses.
type ClaudeManagedAccountsSource = () => ClaudeManagedAccount[]
let accountsSource: ClaudeManagedAccountsSource = () => []

export function configureClaudeStatusLineOwnershipAccounts(
  source: ClaudeManagedAccountsSource
): void {
  accountsSource = source
}

function parseVaultConfig(raw: string | null): HooksConfig | null {
  if (raw === null) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? (parsed as HooksConfig) : null
  } catch {
    return null
  }
}

// Why 'unknown' on parse failure: an unreadable settings.json must never be reported as a
// user-owned slot — the replace consent flow would then offer to rewrite a file it cannot read.
function homeSlotState(): ClaudeStatusLineUniverseState {
  const config = readHooksJson(getConfigPath())
  if (!config) {
    return 'unknown'
  }
  return getStatusLineSlotState(config, getStatusLineScriptFileName())
}

// The consented half of the never-overwrite contract: remove the user's key plus the opt-out
// marker (an empty slot with the marker reads as opt-out, which would no-op the install), then
// let the same install() merge that runs at boot fill the now-empty slot.
function adoptUserOwnedHomeStatusLine(service: ClaudeHookService): void {
  const configPath = getConfigPath()
  const config = readHooksJson(configPath)
  if (!config || getStatusLineSlotState(config, getStatusLineScriptFileName()) !== 'user') {
    return
  }
  rmSync(getStatusLineInstallMarkerPath(), { force: true })
  const next = { ...config }
  delete next.statusLine
  writeHooksJson(configPath, next)
  service.install()
}

function vaultSlotState(account: ClaudeManagedAccount): ClaudeStatusLineUniverseState {
  // Why unknown for WSL: the vault's disk lives inside the distro; this host-side path cannot
  // see it and must never claim a state it did not read.
  if (account.managedAuthRuntime === 'wsl') {
    return 'unknown'
  }
  if (!existsSync(join(account.managedAuthPath, 'settings.json'))) {
    return 'empty'
  }
  const config = parseVaultConfig(
    readClaudeManagedAuthFile(account.managedAuthPath, 'settings.json')
  )
  if (!config) {
    return 'unknown'
  }
  return getStatusLineSlotState(config, getStatusLineScriptFileName())
}

export function getClaudeStatusLineOwnership(): ClaudeStatusLineOwnership {
  const universes: ClaudeStatusLineUniverseOwnership[] = [
    { universe: 'home', accountId: null, accountEmail: null, state: homeSlotState() }
  ]
  for (const account of accountsSource()) {
    universes.push({
      universe: 'vault',
      accountId: account.id,
      accountEmail: account.email,
      state: vaultSlotState(account)
    })
  }
  return {
    universes,
    userOwnedHome: universes[0]!.state === 'user',
    userOwnedVaultCount: universes.filter(
      (universe) => universe.universe === 'vault' && universe.state === 'user'
    ).length
  }
}

/**
 * The consented replacement: clears the user's statusLine key in EVERY universe that has one
 * and installs the managed line right away — one consent covers all universes, because a
 * single stale survivor keeps blocking pinned launches.
 */
export function replaceUserOwnedClaudeStatusLines(
  service: ClaudeHookService = claudeHookService
): ClaudeStatusLineReplaceResult {
  let failedCount = 0
  try {
    adoptUserOwnedHomeStatusLine(service)
  } catch (error) {
    failedCount += 1
    console.warn('[claude-statusline] failed to replace the home statusLine:', error)
  }
  for (const account of accountsSource()) {
    if (vaultSlotState(account) !== 'user') {
      continue
    }
    try {
      const config = parseVaultConfig(
        readClaudeManagedAuthFile(account.managedAuthPath, 'settings.json')
      )
      if (!config) {
        failedCount += 1
        continue
      }
      const next = { ...config }
      delete next.statusLine
      // Why the vault merge and not a bare write: pinning uses this exact merge, so the freed
      // slot gets the managed statusLine (and hooks) now instead of on the next launch.
      const merged = service.ensureInjectedVaultInstrumentation(JSON.stringify(next))
      writeClaudeManagedAuthFile(
        account.managedAuthPath,
        'settings.json',
        merged ?? `${JSON.stringify(next, null, 2)}\n`
      )
    } catch (error) {
      failedCount += 1
      console.warn(
        `[claude-statusline] failed to replace the statusLine in vault ${account.id}:`,
        error
      )
    }
  }
  return { failedCount, ownership: getClaudeStatusLineOwnership() }
}
