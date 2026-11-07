import { posix, win32 } from 'node:path'

/** A settings.json hook whose script file is gone, so Claude fails it on every matching event. */
export type DeadHookScript = {
  settingsPath: string
  event: string
  /** The hook's statusMessage when it has one, otherwise the script's file name. */
  name: string
  /** The plugin or skill folder the script lived in, when its path says so. */
  plugin: string | null
  scriptPath: string
}

const SCRIPT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.sh',
  '.py',
  '.ps1',
  '.cmd',
  '.bat'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbsoluteScript(token: string): boolean {
  const isAbsolute = posix.isAbsolute(token) || win32.isAbsolute(token)
  return isAbsolute && SCRIPT_EXTENSIONS.has(win32.extname(token).toLowerCase())
}

// Why only literal absolute paths: `$HOME/...` and `${CLAUDE_PLUGIN_ROOT}/...` resolve at run
// time, so a missing file at that spelling proves nothing.
function scriptPathsOf(hook: Record<string, unknown>): string[] {
  const tokens: string[] = []
  if (typeof hook.command === 'string') {
    for (const match of hook.command.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)) {
      tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
    }
  }
  if (Array.isArray(hook.args)) {
    tokens.push(...hook.args.filter((arg): arg is string => typeof arg === 'string'))
  }
  return [...new Set(tokens.filter(isAbsoluteScript))]
}

/** `<...>/plugins/<id>/...`, Claude's `plugins/cache/<marketplace>/<plugin>/...`, or `skills/<name>/...`. */
export function pluginNameFromScriptPath(scriptPath: string): string | null {
  const parts = scriptPath.split(/[\\/]+/)
  const pluginsAt = parts.lastIndexOf('plugins')
  if (pluginsAt !== -1) {
    const owner = parts[pluginsAt + 1] === 'cache' ? parts[pluginsAt + 3] : parts[pluginsAt + 1]
    if (owner) {
      return owner
    }
  }
  const skillsAt = parts.lastIndexOf('skills')
  return skillsAt !== -1 ? (parts[skillsAt + 2] ? parts[skillsAt + 1] : null) : null
}

export function findDeadHookScripts(
  settingsPath: string,
  settings: unknown,
  exists: (path: string) => boolean
): DeadHookScript[] {
  if (!isRecord(settings) || !isRecord(settings.hooks)) {
    return []
  }
  const dead: DeadHookScript[] = []
  for (const [event, definitions] of Object.entries(settings.hooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    for (const definition of definitions) {
      const hooks = isRecord(definition) && Array.isArray(definition.hooks) ? definition.hooks : []
      for (const hook of hooks.filter(isRecord)) {
        for (const scriptPath of scriptPathsOf(hook)) {
          if (exists(scriptPath)) {
            continue
          }
          const name =
            typeof hook.statusMessage === 'string' && hook.statusMessage.trim().length > 0
              ? hook.statusMessage.trim()
              : win32.basename(scriptPath)
          dead.push({
            settingsPath,
            event,
            name,
            plugin: pluginNameFromScriptPath(scriptPath),
            scriptPath
          })
        }
      }
    }
  }
  return dead
}
