import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginHookEntry } from '../../shared/global-config-sync'
import { parseEnabledPluginInstalls, parsePluginHookEntries } from '../../shared/global-config-sync'
import type { HookCommandConfig, HookDefinition, HooksConfig } from '../agent-hooks/installer-utils'

// Plugin hooks reference ${CLAUDE_PLUGIN_ROOT}, which only the Claude plugin
// loader defines. Managed vaults (and even the seeding of the global settings)
// never run that loader, so these helpers collect enabled-plugin hooks with the
// path pre-expanded and merge them into a settings.json `hooks` key.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTextFileOrNull(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null
  } catch {
    return null
  }
}

/**
 * Collects hooks contributed by every enabled user-scope Claude plugin, with
 * `${CLAUDE_PLUGIN_ROOT}` pre-expanded to each plugin's install path. This is how
 * plugin auto-memory hooks (e.g. Engram's SessionStart/Stop) reach an isolated
 * vault or the global settings, since the vault never runs the plugin loader.
 */
export function collectGlobalHooks(homeDir: string): PluginHookEntry[] {
  const installedPlugins = readTextFileOrNull(
    join(homeDir, '.claude', 'plugins', 'installed_plugins.json')
  )
  const settings = readTextFileOrNull(join(homeDir, '.claude', 'settings.json'))
  const installs = parseEnabledPluginInstalls(installedPlugins, [settings])
  return installs.flatMap((install) =>
    parsePluginHookEntries(
      install.pluginName,
      install.installPath,
      readTextFileOrNull(join(install.installPath, 'hooks', 'hooks.json'))
    )
  )
}

/**
 * Merges plugin hook entries into a parsed settings object under the `hooks` key.
 * Hooks are keyed by event to an array of definitions, so entries are appended
 * per event and deduped by command — this preserves any hooks already present
 * (e.g. Orca's own status hooks) and stays idempotent across repeated syncs.
 */
export function mergeHooksIntoSettingsObject(
  base: Record<string, unknown>,
  hooks: PluginHookEntry[]
): { config: HooksConfig; changed: boolean } {
  const existingHooks = isPlainObject(base.hooks)
    ? (base.hooks as Record<string, HookDefinition[]>)
    : {}
  const nextHooks: Record<string, HookDefinition[]> = {}
  for (const [event, definitions] of Object.entries(existingHooks)) {
    nextHooks[event] = Array.isArray(definitions) ? definitions.map((def) => ({ ...def })) : []
  }
  let changed = false
  for (const entry of hooks) {
    const list = (nextHooks[entry.event] ??= [])
    const alreadyPresent = list.some(
      (def) => Array.isArray(def.hooks) && def.hooks.some((hook) => hook.command === entry.command)
    )
    if (alreadyPresent) {
      continue
    }
    const command: HookCommandConfig = { type: 'command', command: entry.command }
    if (entry.timeout !== undefined) {
      command.timeout = entry.timeout
    }
    if (entry.async !== undefined) {
      command.async = entry.async
    }
    const definition: HookDefinition = { hooks: [command] }
    if (entry.matcher !== undefined) {
      definition.matcher = entry.matcher
    }
    list.push(definition)
    changed = true
  }
  return { config: { ...base, hooks: nextHooks }, changed }
}

/**
 * Serialized-string variant of mergeHooksIntoSettingsObject for the vault
 * settings.json. Returns null when nothing changed (skip the write, preserve
 * formatting) or when the existing content is unparseable (never clobber — the
 * vault settings.json may hold a custom-endpoint token).
 */
export function mergeHooksIntoVaultSettings(
  existingSettingsJson: string | null,
  hooks: PluginHookEntry[]
): string | null {
  if (hooks.length === 0) {
    return null
  }
  let base: Record<string, unknown> = {}
  if (existingSettingsJson) {
    try {
      const parsed: unknown = JSON.parse(existingSettingsJson)
      if (!isPlainObject(parsed)) {
        return null
      }
      base = parsed
    } catch {
      return null
    }
  }
  const { config, changed } = mergeHooksIntoSettingsObject(base, hooks)
  return changed ? `${JSON.stringify(config, null, 2)}\n` : null
}
