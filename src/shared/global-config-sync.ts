// Shared types + pure parsing for the pre-sync "Sync global config" popup.
// Managed Claude accounts run against isolated CLAUDE_CONFIG_DIR vaults, so the
// user's global MCP servers, skills, and plugin hooks are seeded into each vault
// (and optionally the global ~/.claude/settings.json for non-pinned sessions).
// This module stays fs-free so it can be unit-tested and imported from renderer;
// the main process does the disk reads and hands the file contents in.

/** Where a global MCP server definition was found. */
export type GlobalConfigMcpSource = 'user-config' | 'settings' | 'plugin-dir'

export type GlobalConfigMcpEntry = {
  name: string
  source: GlobalConfigMcpSource
}

/**
 * A single plugin-provided hook, resolved to an absolute command. Plugin
 * `hooks.json` files reference `${CLAUDE_PLUGIN_ROOT}`, which only the Claude
 * plugin loader defines — an isolated vault never loads it, so the command is
 * pre-expanded to the plugin's install path here.
 */
export type PluginHookEntry = {
  id: string
  pluginName: string
  event: string
  matcher?: string
  command: string
  timeout?: number
  async?: boolean
}

export type GlobalConfigSyncInventory = {
  mcpServers: GlobalConfigMcpEntry[]
  skills: string[]
  hooks: PluginHookEntry[]
}

export type GlobalConfigSyncSelection = {
  mcpServerNames: string[]
  skillNames: string[]
  hookIds: string[]
  writeGlobalHooks: boolean
}

/** A user-scope enabled plugin resolved to its on-disk install path. */
export type EnabledPluginInstall = {
  pluginId: string
  pluginName: string
  installPath: string
}

const CLAUDE_PLUGIN_ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonObject(content: string | null): Record<string, unknown> | null {
  if (!content) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(content)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The package portion of an `id@marketplace` plugin id, for a human-readable label. */
export function pluginDisplayName(pluginId: string): string {
  return pluginId.split('@')[0] || pluginId
}

/** Reads `enabledPlugins` across the merged settings files (later files win). */
function readEnabledPlugins(settingsJsons: readonly (string | null)[]): Map<string, boolean> {
  const enabled = new Map<string, boolean>()
  for (const content of settingsJsons) {
    const configured = parseJsonObject(content)?.enabledPlugins
    if (!isPlainObject(configured)) {
      continue
    }
    for (const [pluginId, value] of Object.entries(configured)) {
      if (typeof value === 'boolean') {
        enabled.set(pluginId, value)
      }
    }
  }
  return enabled
}

/**
 * Resolves enabled user-scope plugins to their install path from
 * `installed_plugins.json`. Hooks are a user-scope concern, so project/local
 * installs are ignored; only entries with an absolute install path are kept.
 */
export function parseEnabledPluginInstalls(
  installedPluginsJson: string | null,
  settingsJsons: readonly (string | null)[]
): EnabledPluginInstall[] {
  const installed = parseJsonObject(installedPluginsJson)?.plugins
  if (!isPlainObject(installed)) {
    return []
  }
  const enabled = readEnabledPlugins(settingsJsons)
  const installs: EnabledPluginInstall[] = []
  for (const [pluginId, rawInstalls] of Object.entries(installed)) {
    if (enabled.get(pluginId) !== true || !Array.isArray(rawInstalls)) {
      continue
    }
    for (const raw of rawInstalls) {
      if (!isPlainObject(raw) || raw.scope !== 'user' || typeof raw.installPath !== 'string') {
        continue
      }
      installs.push({
        pluginId,
        pluginName: pluginDisplayName(pluginId),
        installPath: raw.installPath
      })
      break
    }
  }
  return installs
}

function scriptStem(command: string): string {
  const segment = command.split(/[\\/]/).pop() ?? command
  return segment.replace(/\.(?:sh|cmd|ps1|js|ts)$/i, '')
}

function toHookCommandConfigs(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isPlainObject)
}

/**
 * Flattens a plugin's `hooks.json` into absolute-command `PluginHookEntry`s.
 * Accepts either the wrapped `{ hooks: { Event: [...] } }` shape or a bare
 * `{ Event: [...] }` map, expanding `${CLAUDE_PLUGIN_ROOT}` to `installPath`.
 */
export function parsePluginHookEntries(
  pluginName: string,
  installPath: string,
  hooksJson: string | null
): PluginHookEntry[] {
  const root = parseJsonObject(hooksJson)
  if (!root) {
    return []
  }
  const events = isPlainObject(root.hooks) ? root.hooks : root
  const entries: PluginHookEntry[] = []
  for (const [event, rawDefinitions] of Object.entries(events)) {
    if (!Array.isArray(rawDefinitions)) {
      continue
    }
    for (const definition of rawDefinitions) {
      if (!isPlainObject(definition)) {
        continue
      }
      const matcher = typeof definition.matcher === 'string' ? definition.matcher : undefined
      for (const hook of toHookCommandConfigs(definition.hooks)) {
        if (typeof hook.command !== 'string') {
          continue
        }
        const command = hook.command.split(CLAUDE_PLUGIN_ROOT_TOKEN).join(installPath)
        entries.push({
          id: `${pluginName}:${event}:${matcher ?? ''}:${scriptStem(command)}`,
          pluginName,
          event,
          ...(matcher !== undefined ? { matcher } : {}),
          command,
          ...(typeof hook.timeout === 'number' ? { timeout: hook.timeout } : {}),
          ...(hook.async === true ? { async: true } : {})
        })
      }
    }
  }
  return entries
}
