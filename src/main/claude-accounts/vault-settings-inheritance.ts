import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ClaudeVaultSettingInheritance,
  ClaudeVaultSettingInheritanceKey,
  ClaudeVaultSettingsInheritanceReport
} from '../../shared/types'
import { ensureVaultOutputStyleLinks, outputStyleResolvesInVault } from './vault-output-styles'
import {
  INHERITABLE_VAULT_SETTING_KEYS,
  describeSettingInheritance,
  mergeUserSettingsIntoVaultSettings,
  parseSettingsObject,
  selectInheritableSettings
} from './vault-user-settings'

function readHomeSettingsJson(homeDir: string): string | null {
  const path = join(homeDir, '.claude', 'settings.json')
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  } catch {
    return null
  }
}

/** The user's inheritable home settings, with `outputStyle` dropped when this
 *  vault cannot load the named style (see vault-output-styles for why). */
function resolveInheritableForVault(
  homeDir: string,
  vaultAuthPath: string
): Partial<Record<ClaudeVaultSettingInheritanceKey, unknown>> {
  const homeSettings = parseSettingsObject(readHomeSettingsJson(homeDir))
  if (homeSettings === null) {
    return {}
  }
  const inheritable = selectInheritableSettings(homeSettings)
  if (
    'outputStyle' in inheritable &&
    !outputStyleResolvesInVault(vaultAuthPath, inheritable.outputStyle)
  ) {
    delete inheritable.outputStyle
  }
  return inheritable
}

/**
 * Merges the user's home settings into one vault's settings.json, linking the
 * output styles first so a style name has a file behind it. Returns the JSON to
 * write, or null when nothing changed (skip the write, keep the formatting).
 *
 * Runs on every pinned launch rather than only at account creation: that is what
 * makes a fifth vault — and a home file edited after the vault existed — inherit
 * without anyone re-running a sync.
 */
export function buildInheritedVaultSettings(
  vaultAuthPath: string,
  homeDir: string,
  existingSettingsJson: string | null
): string | null {
  ensureVaultOutputStyleLinks(vaultAuthPath, homeDir)
  return mergeUserSettingsIntoVaultSettings(
    existingSettingsJson,
    resolveInheritableForVault(homeDir, vaultAuthPath)
  )
}

/**
 * Per-key inheritance state of one vault, for the `terminal` block of
 * `orca account list`. Read-only: it never links or writes, so asking the
 * question cannot change the answer.
 */
export function describeVaultSettingsInheritance(args: {
  accountId: string
  vaultAuthPath: string
  homeDir: string
  readVaultSettings: () => string | null
}): ClaudeVaultSettingsInheritanceReport {
  const homeSettings = parseSettingsObject(readHomeSettingsJson(args.homeDir))
  const inheritable = homeSettings === null ? {} : selectInheritableSettings(homeSettings)
  const vaultSettings = parseSettingsObject(args.readVaultSettings()) ?? {}
  const keys: ClaudeVaultSettingInheritance[] = INHERITABLE_VAULT_SETTING_KEYS.map((key) => {
    if (
      key === 'outputStyle' &&
      'outputStyle' in inheritable &&
      !outputStyleResolvesInVault(args.vaultAuthPath, inheritable.outputStyle)
    ) {
      return { key, state: 'unresolved' as const }
    }
    return { key, state: describeSettingInheritance(vaultSettings, inheritable, key) }
  })
  return { state: 'vault', accountId: args.accountId, keys }
}
