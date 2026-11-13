import { describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import {
  type DaemonSpawnCall,
  createDaemonActiveProviderFixtures
} from './pty-ipc-daemon-provider-fixtures'

import { _setWslCachesForTests } from '../wsl'
import { registerPtyHandlers } from './pty'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)
type RuntimeController = {
  spawn(args: {
    cols: number
    rows: number
    cwd?: string
    worktreeId?: string
    env?: Record<string, string>
  }): Promise<{ id: string }>
}

describe('runtime-created PTYs with no project on Windows', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()
  const { setupDaemonAdapter, withWin32Platform, makeProjectRuntimeStore } =
    createDaemonActiveProviderFixtures({ handlers, mainWindow })

  async function spawnWorktreeLess(localWindowsRuntimeDefault: unknown): Promise<DaemonSpawnCall> {
    _setWslCachesForTests({ available: true, distros: ['Ubuntu-24.04'] })
    const daemonSpawn = setupDaemonAdapter()
    const runtime = {
      setPtyController: vi.fn(),
      registerPty: vi.fn(),
      onPtySpawned: vi.fn(),
      onPtyExit: vi.fn(),
      onPtyData: vi.fn()
    }
    const settings = {
      localWindowsRuntimeDefault,
      terminalWindowsShell: 'powershell.exe',
      terminalWindowsWslDistro: null,
      terminalWindowsPowerShellImplementation: 'auto'
    }
    const store = makeProjectRuntimeStore({
      projectRuntimePreference: { kind: 'inherit-global' },
      settings
    })
    handlers.clear()
    registerPtyHandlers(
      mainWindow as never,
      runtime as never,
      undefined,
      (() => settings) as never,
      undefined,
      store as never
    )
    const controller = runtime.setPtyController.mock.calls[0]?.[0] as RuntimeController
    await controller.spawn({ cols: 80, rows: 24, cwd: 'C:\\Users\\dev', env: {} })
    return daemonSpawn.mock.calls.at(-1)?.[0] as DaemonSpawnCall
  }

  it('opens WSL with the default distro when the global default is WSL', async () => {
    await withWin32Platform(async () => {
      const spawnOptions = await spawnWorktreeLess({ kind: 'wsl', distro: 'Ubuntu-24.04' })
      expect(spawnOptions.shellOverride).toBe('wsl.exe')
      expect(spawnOptions.terminalWindowsWslDistro).toBe('Ubuntu-24.04')
    })
  })

  it('keeps the Windows shell setting when the global default is the Windows host', async () => {
    await withWin32Platform(async () => {
      const spawnOptions = await spawnWorktreeLess({ kind: 'windows-host' })
      expect(spawnOptions.shellOverride).toBe('powershell.exe')
    })
  })
})
