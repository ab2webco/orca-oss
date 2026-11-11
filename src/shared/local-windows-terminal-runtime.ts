import type {
  GlobalWindowsRuntimeDefault,
  ProjectExecutionRuntimeResolution
} from './project-execution-runtime'
import type { GlobalSettings } from './global-settings-types'

export type LocalWindowsTerminalRuntimeSettings =
  | Partial<
      Pick<
        GlobalSettings,
        'terminalWindowsShell' | 'terminalWindowsWslDistro' | 'localWindowsRuntimeDefault'
      >
    >
  | undefined

export type LocalWindowsTerminalRuntimeOptions = {
  shellOverride: string | undefined
  terminalWindowsWslDistro: string | null
}

export function isWslShellName(shellPath: string | undefined): boolean {
  const shellName = shellPath?.replaceAll('\\', '/').split('/').pop()?.toLowerCase()
  return shellName === 'wsl.exe' || shellName === 'wsl'
}

export function getHostShellForProjectRuntime(
  requestedShell: string | undefined,
  settingsShell: string | undefined,
  fallbackHostShell = 'powershell.exe'
): string {
  const candidate = requestedShell ?? settingsShell
  if (candidate && !isWslShellName(candidate)) {
    return candidate
  }
  return fallbackHostShell
}

export function resolveLocalWindowsTerminalRuntimeOptions(args: {
  requestedShellOverride: string | undefined
  settings: LocalWindowsTerminalRuntimeSettings
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
  fallbackHostShell?: string
}): LocalWindowsTerminalRuntimeOptions {
  const settingsShell = args.settings?.terminalWindowsShell
  const settingsWslDistro = args.settings?.terminalWindowsWslDistro ?? null
  const projectRuntime = args.projectRuntime
  if (!projectRuntime) {
    const wslDefault = args.settings?.localWindowsRuntimeDefault
    if (wslDefault?.kind !== 'wsl') {
      return {
        shellOverride: args.requestedShellOverride ?? settingsShell,
        terminalWindowsWslDistro: settingsWslDistro
      }
    }
    // Why: folder and floating terminals have no project; a WSL default must reach them on both the renderer and main spawn paths.
    const shellOverride = args.requestedShellOverride ?? 'wsl.exe'
    return {
      shellOverride,
      terminalWindowsWslDistro: isWslShellName(shellOverride)
        ? (wslDefault.distro ?? settingsWslDistro)
        : settingsWslDistro
    }
  }

  if (projectRuntime.status === 'repair-required') {
    throw new Error(
      `Project runtime requires repair before terminal spawn: ${projectRuntime.repair.reason}`
    )
  }

  if (projectRuntime.runtime.kind === 'wsl') {
    return {
      shellOverride: 'wsl.exe',
      terminalWindowsWslDistro: projectRuntime.runtime.distro
    }
  }

  return {
    shellOverride: getHostShellForProjectRuntime(
      args.requestedShellOverride,
      settingsShell,
      args.fallbackHostShell
    ),
    terminalWindowsWslDistro: null
  }
}

export function resolveLocalWindowsTerminalShellOverrideForTab(args: {
  explicitShellOverride: string | undefined
  defaultWindowsShell: string | undefined
  globalWindowsRuntimeDefault?: GlobalWindowsRuntimeDefault
  isWslWorktree: boolean
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
  fallbackHostShell?: string
}): string | undefined {
  if (args.projectRuntime?.status === 'repair-required') {
    // Why: repair-required WSL still owns the project runtime; the tab should
    // advertise the intended runtime instead of falling back to host metadata.
    return 'wsl.exe'
  }

  if (args.projectRuntime) {
    return resolveLocalWindowsTerminalRuntimeOptions({
      requestedShellOverride: args.explicitShellOverride,
      settings: {
        terminalWindowsShell: args.defaultWindowsShell,
        terminalWindowsWslDistro: null
      },
      projectRuntime: args.projectRuntime,
      fallbackHostShell: args.fallbackHostShell
    }).shellOverride
  }

  if (args.explicitShellOverride !== undefined) {
    return args.explicitShellOverride
  }
  if (args.isWslWorktree || args.globalWindowsRuntimeDefault?.kind === 'wsl') {
    return 'wsl.exe'
  }
  return args.defaultWindowsShell
}
