import { describe, expect, it } from 'vitest'
import {
  resolveLocalWindowsTerminalRuntimeOptions,
  resolveLocalWindowsTerminalShellOverrideForTab
} from './local-windows-terminal-runtime'
import type { ProjectExecutionRuntimeResolution } from './project-execution-runtime'

const hostProjectRuntime: ProjectExecutionRuntimeResolution = {
  status: 'resolved',
  runtime: {
    kind: 'windows-host',
    hostPlatform: 'win32',
    projectId: 'project-1',
    reason: 'project-override',
    cacheKey: 'project-1:windows-host'
  }
}

describe('resolveLocalWindowsTerminalRuntimeOptions without a project runtime', () => {
  it('opens WSL with the default distro when the global default is WSL', () => {
    expect(
      resolveLocalWindowsTerminalRuntimeOptions({
        requestedShellOverride: undefined,
        settings: {
          terminalWindowsShell: 'powershell.exe',
          terminalWindowsWslDistro: 'Debian',
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu-24.04' }
        },
        projectRuntime: undefined
      })
    ).toEqual({ shellOverride: 'wsl.exe', terminalWindowsWslDistro: 'Ubuntu-24.04' })
  })

  it('keeps an explicit per-tab host shell when the global default is WSL', () => {
    expect(
      resolveLocalWindowsTerminalRuntimeOptions({
        requestedShellOverride: 'powershell.exe',
        settings: {
          terminalWindowsShell: 'powershell.exe',
          terminalWindowsWslDistro: null,
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu-24.04' }
        },
        projectRuntime: undefined
      })
    ).toEqual({ shellOverride: 'powershell.exe', terminalWindowsWslDistro: null })
  })

  it('gives an explicit wsl.exe tab the default distro', () => {
    expect(
      resolveLocalWindowsTerminalRuntimeOptions({
        requestedShellOverride: 'wsl.exe',
        settings: {
          terminalWindowsShell: 'powershell.exe',
          terminalWindowsWslDistro: null,
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu-24.04' }
        },
        projectRuntime: undefined
      })
    ).toEqual({ shellOverride: 'wsl.exe', terminalWindowsWslDistro: 'Ubuntu-24.04' })
  })

  it('keeps the Windows shell setting when the global default is the Windows host', () => {
    expect(
      resolveLocalWindowsTerminalRuntimeOptions({
        requestedShellOverride: undefined,
        settings: {
          terminalWindowsShell: 'cmd.exe',
          terminalWindowsWslDistro: null,
          localWindowsRuntimeDefault: { kind: 'windows-host' }
        },
        projectRuntime: undefined
      })
    ).toEqual({ shellOverride: 'cmd.exe', terminalWindowsWslDistro: null })
  })

  it('leaves a project runtime in charge over a WSL global default', () => {
    expect(
      resolveLocalWindowsTerminalRuntimeOptions({
        requestedShellOverride: undefined,
        settings: {
          terminalWindowsShell: 'cmd.exe',
          terminalWindowsWslDistro: null,
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu-24.04' }
        },
        projectRuntime: hostProjectRuntime
      })
    ).toEqual({ shellOverride: 'cmd.exe', terminalWindowsWslDistro: null })
  })
})

describe('resolveLocalWindowsTerminalShellOverrideForTab without a project runtime', () => {
  it('stamps wsl.exe on a new tab when the global default is WSL', () => {
    expect(
      resolveLocalWindowsTerminalShellOverrideForTab({
        explicitShellOverride: undefined,
        defaultWindowsShell: 'powershell.exe',
        globalWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu-24.04' },
        isWslWorktree: false,
        projectRuntime: undefined
      })
    ).toBe('wsl.exe')
  })

  it('keeps a shell picked from the per-tab selector', () => {
    expect(
      resolveLocalWindowsTerminalShellOverrideForTab({
        explicitShellOverride: 'powershell.exe',
        defaultWindowsShell: 'powershell.exe',
        globalWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu-24.04' },
        isWslWorktree: false,
        projectRuntime: undefined
      })
    ).toBe('powershell.exe')
  })

  it('stamps the Windows shell setting when the global default is the Windows host', () => {
    expect(
      resolveLocalWindowsTerminalShellOverrideForTab({
        explicitShellOverride: undefined,
        defaultWindowsShell: 'cmd.exe',
        globalWindowsRuntimeDefault: { kind: 'windows-host' },
        isWslWorktree: false,
        projectRuntime: undefined
      })
    ).toBe('cmd.exe')
  })
})
