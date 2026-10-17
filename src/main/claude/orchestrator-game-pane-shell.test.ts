import { describe, expect, it } from 'vitest'
import {
  localOrchestratorGamePaneShell,
  orchestratorGamePaneShell
} from './orchestrator-game-pane-shell'

const windows = (shellOverride: string | undefined, extra: { cwd?: string } = {}) =>
  orchestratorGamePaneShell({ platform: 'win32', shellOverride, wslDistro: null, ...extra })

describe('orchestratorGamePaneShell', () => {
  it('quotes for POSIX on macOS and Linux whatever shell is named', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(
        orchestratorGamePaneShell({ platform, shellOverride: 'cmd.exe', wslDistro: null })
      ).toBe('posix')
    }
  })

  it('quotes for the Windows pane shell Orca opens', () => {
    expect(windows('powershell.exe')).toBe('powershell')
    expect(windows('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
    expect(windows('cmd.exe')).toBe('cmd')
    expect(windows('C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(windows('git-bash')).toBe('posix')
    expect(windows('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('posix')
    // Why: Orca's own default for an unset Windows shell is PowerShell.
    expect(windows(undefined)).toBe('powershell')
  })

  it('skips the game in a WSL pane, whose Linux Claude cannot load a Windows plugin dir', () => {
    expect(windows('wsl.exe')).toBeNull()
    expect(windows('C:\\Windows\\System32\\wsl.exe')).toBeNull()
    expect(
      windows('powershell.exe', { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo' })
    ).toBeNull()
    expect(windows('cmd.exe', { cwd: '\\\\wsl$\\Debian\\srv' })).toBeNull()
    expect(
      orchestratorGamePaneShell({
        platform: 'win32',
        shellOverride: 'powershell.exe',
        wslDistro: 'Ubuntu'
      })
    ).toBeNull()
  })
})

describe('localOrchestratorGamePaneShell', () => {
  const wslProject = {
    status: 'resolved',
    runtime: {
      kind: 'wsl',
      hostPlatform: 'wsl',
      projectId: 'repo-1',
      distro: 'Ubuntu',
      reason: 'project-override',
      cacheKey: 'k'
    }
  } as const

  it('resolves the shell a runtime-created pane will open in, as the pty spawn does', () => {
    const local = (settings: { terminalWindowsShell?: string }, cwd = 'C:\\repo') =>
      localOrchestratorGamePaneShell({
        platform: 'win32',
        settings,
        projectRuntime: undefined,
        cwd,
        fallbackHostShell: 'powershell.exe'
      })

    expect(local({ terminalWindowsShell: 'cmd.exe' })).toBe('cmd')
    expect(local({ terminalWindowsShell: 'git-bash' })).toBe('posix')
    expect(local({ terminalWindowsShell: 'pwsh.exe' })).toBe('powershell')
    expect(local({ terminalWindowsShell: 'wsl.exe' })).toBeNull()
    expect(local({ terminalWindowsShell: 'cmd.exe' }, '\\\\wsl$\\Ubuntu\\repo')).toBeNull()
  })

  it('skips a WSL project and keeps POSIX off Windows', () => {
    expect(
      localOrchestratorGamePaneShell({
        platform: 'win32',
        settings: { terminalWindowsShell: 'cmd.exe' },
        projectRuntime: wslProject,
        cwd: 'C:\\repo',
        fallbackHostShell: 'powershell.exe'
      })
    ).toBeNull()
    expect(
      localOrchestratorGamePaneShell({
        platform: 'darwin',
        settings: undefined,
        projectRuntime: undefined,
        cwd: '/repo',
        fallbackHostShell: 'powershell.exe'
      })
    ).toBe('posix')
  })

  it('skips the game rather than throw when the project runtime needs repair', () => {
    expect(
      localOrchestratorGamePaneShell({
        platform: 'win32',
        settings: undefined,
        projectRuntime: {
          status: 'repair-required',
          repair: {
            projectId: 'repo-1',
            preferredRuntime: { kind: 'wsl', distro: null },
            reason: 'wsl-unavailable',
            source: 'project-override',
            cacheKey: 'k'
          }
        },
        cwd: 'C:\\repo',
        fallbackHostShell: 'powershell.exe'
      })
    ).toBeNull()
  })
})
