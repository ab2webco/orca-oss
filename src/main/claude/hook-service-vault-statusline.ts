import { existsSync, writeFileSync } from 'node:fs'
import { isPlainObject, writeManagedScript, type HooksConfig } from '../agent-hooks/installer-utils'
import {
  applyManagedStatusLine,
  getManagedCommand,
  getStatusLineInstallMarkerPath,
  getStatusLineScriptFileName,
  getStatusLineScriptPath,
  getStatusLineSlotState,
  type ClaudeCompatibleHookSettings
} from './hook-settings'
import { getManagedStatusLineScript } from './statusline-script'

export function parseVaultConfig(currentSettingsJson: string | null): HooksConfig | null {
  if (currentSettingsJson === null) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(currentSettingsJson)
    return isPlainObject(parsed) ? (parsed as HooksConfig) : null
  } catch {
    return null
  }
}

// Why: the statusline feed is opportunistic (usage display, not agent status); a user who deleted the
// managed entry has opted out, and the marker distinguishes that deletion from a first install.
export function installManagedStatusLine(
  config: HooksConfig,
  settingsPath: ClaudeCompatibleHookSettings
): HooksConfig {
  const scriptFileName = getStatusLineScriptFileName(settingsPath)
  const markerPath = getStatusLineInstallMarkerPath(settingsPath)
  const slot = getStatusLineSlotState(config, scriptFileName)
  // Why refresh the script before the slot decision: the file is shared, and every managed
  // account's vault settings.json points at it. Skipping the write because THIS config has a
  // user-owned statusLine froze the script for every pinned vault that depends on it — a user
  // with their own line stopped everyone from getting statusline updates, including themselves
  // through their pinned accounts.
  const statusLineScriptPath = getStatusLineScriptPath(settingsPath)
  writeManagedScript(statusLineScriptPath, getManagedStatusLineScript('local'))
  if (slot === 'user' || (slot === 'empty' && existsSync(markerPath))) {
    return config
  }
  const next = applyManagedStatusLine(
    config,
    getManagedCommand(statusLineScriptPath),
    scriptFileName
  )
  try {
    writeFileSync(markerPath, '')
  } catch {
    // Best-effort: a missing marker only means one future user deletion gets re-installed once.
  }
  return next
}
