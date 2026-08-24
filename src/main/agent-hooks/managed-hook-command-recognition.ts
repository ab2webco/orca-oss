import type { HookCommandConfig, HookDefinition } from './hook-config-types'

// Why: match by script file name, not exact command, so a fresh install sweeps stale entries from old/parallel installs.
export function createManagedCommandMatcher(
  scriptFileName: string
): (command: string | undefined) => boolean {
  const scriptStem = scriptFileName.replace(/\.(?:cmd|ps1|sh)$/, '')
  // Why: installs use .cmd/.ps1 (Windows) or .sh (SSH/POSIX); match all so a platform switch still sweeps stale hooks.
  const needles = [
    `agent-hooks/${scriptFileName}`,
    `agent-hooks/${scriptStem}.cmd`,
    `agent-hooks/${scriptStem}.ps1`,
    `agent-hooks/${scriptStem}.sh`
  ]
  return (command) => {
    if (!command) {
      return false
    }
    const decodedCommand = decodePowerShellEncodedCommand(command)
    const searchText = decodedCommand ? `${command}\n${decodedCommand}` : command
    const normalizedCommand = searchText.replaceAll('\\', '/')
    return needles.some((needle) => normalizedCommand.includes(needle))
  }
}

function decodePowerShellEncodedCommand(command: string): string | null {
  const match = command.match(/\s-EncodedCommand\s+(\S+)/i)
  if (!match) {
    return null
  }
  try {
    return Buffer.from(match[1], 'base64').toString('utf16le')
  } catch {
    return null
  }
}

// Why this and not a bare `hook.command` test: Claude's Windows exec form leaves `conhost.exe`
// in `command` and puts the script in `args`, so a command-only check stops recognizing our own
// hook — and Orca then re-injects it or fails to sweep it.
export function hookHasManagedCommand(
  hook: HookCommandConfig,
  matches: (value?: string) => boolean
): boolean {
  const args = stringArgs(hook)
  if (matches(hook.command) || args.some((arg) => matches(arg))) {
    return true
  }
  // Why the joined form too: the PowerShell fallback names the script only inside its base64
  // -EncodedCommand payload, and the flag and the payload are separate argv entries — neither
  // decodes alone, so per-part matching never sees it.
  return matches([hook.command, ...args].join(' '))
}

function stringArgs(hook: HookCommandConfig): string[] {
  return Array.isArray(hook.args) ? hook.args.filter((arg) => typeof arg === 'string') : []
}

export function hookDefinitionHasManagedCommand(
  definition: HookDefinition,
  isManagedCommand: (command: string | undefined) => boolean
): boolean {
  return (
    isManagedCommand(definition.command) ||
    isManagedCommand(definition.bash) ||
    isManagedCommand(definition.powershell) ||
    (Array.isArray(definition.hooks) &&
      definition.hooks.some((hook) => hookHasManagedCommand(hook, isManagedCommand)))
  )
}
