import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  isWslShellName,
  resolveLocalWindowsTerminalRuntimeOptions
} from '../../shared/local-windows-terminal-runtime'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import { resolveWindowsShellStartupFamily } from '../../shared/windows-terminal-shell'
import { parseWslUncPath } from '../../shared/wsl-paths'

/**
 * The shell that parses a local game pane's command line, or null when the game cannot load there.
 * Why null for WSL: the pane runs the distro's Linux Claude, which cannot load the plugin from a
 * Windows path, and the game's env (ORCA_GAME_*) is not crossed into the distro.
 */
export function orchestratorGamePaneShell(args: {
  platform: NodeJS.Platform
  shellOverride: string | undefined
  wslDistro: string | null
  cwd?: string
}): AgentStartupShell | null {
  if (args.platform !== 'win32') {
    return 'posix'
  }
  if (
    args.wslDistro !== null ||
    isWslShellName(args.shellOverride) ||
    (args.cwd !== undefined && parseWslUncPath(args.cwd) !== null)
  ) {
    return null
  }
  return resolveWindowsShellStartupFamily(args.shellOverride)
}

/** The same answer for a pane the runtime creates, from what its pty spawn will resolve the shell from. */
export function localOrchestratorGamePaneShell(args: {
  platform: NodeJS.Platform
  settings:
    | Partial<Pick<GlobalSettings, 'terminalWindowsShell' | 'terminalWindowsWslDistro'>>
    | undefined
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
  cwd: string
  fallbackHostShell: string
}): AgentStartupShell | null {
  if (args.platform !== 'win32') {
    return 'posix'
  }
  try {
    const options = resolveLocalWindowsTerminalRuntimeOptions({
      requestedShellOverride: undefined,
      settings: args.settings,
      projectRuntime: args.projectRuntime,
      fallbackHostShell: args.fallbackHostShell
    })
    // Why no distro: the settings' preferred distro is returned for every shell, WSL or not.
    return orchestratorGamePaneShell({
      platform: args.platform,
      shellOverride: options.shellOverride,
      wslDistro: null,
      cwd: args.cwd
    })
  } catch {
    // Why: a project runtime that needs repair fails the spawn itself; the game just stays out.
    return null
  }
}
