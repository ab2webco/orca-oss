import { describe, expect, it, vi } from 'vitest'
import { spawnMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { registerPtyHandlers, getPtyRendererDeliveryDebugSnapshot } from './pty'
import {
  PTY_RENDERER_INTERACTIVE_RESERVE_CHARS,
  PTY_RENDERER_MAX_IN_FLIGHT_CHARS,
  PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS
} from '../../shared/pty-renderer-delivery-window'

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

describe('renderer delivery window', () => {
  const { handlers, mainWindow, createMockProc, getPtySetActiveRendererPtyListener } =
    setupPtyIpcSuite()

  function drain(): void {
    for (let tick = 0; tick < 1200; tick++) {
      vi.advanceTimersByTime(1)
    }
  }

  it('overshoots the active limit by at most one chunk while no ACK arrives', async () => {
    vi.useFakeTimers()
    const backgroundProcs = Array.from({ length: 17 }, () => createMockProc())
    const activeProc = createMockProc()
    for (const proc of [...backgroundProcs, activeProc]) {
      spawnMock.mockReturnValueOnce(proc.proc)
    }

    try {
      registerPtyHandlers(mainWindow as never)
      const spawns: { id: string }[] = []
      for (let index = 0; index < backgroundProcs.length + 1; index++) {
        spawns.push(
          (await handlers.get('pty:spawn')!(null, { cols: 80, rows: 24, cwd: '/tmp' })) as {
            id: string
          }
        )
      }
      // Why the odd lead-in: off-grid in-flight totals make the pre-send check land past the limit.
      for (const proc of backgroundProcs) {
        proc.emitData('y'.repeat(1000))
      }
      drain()
      for (const proc of backgroundProcs) {
        proc.emitData('x'.repeat(768 * 1024))
      }
      drain()
      getPtySetActiveRendererPtyListener()(null, { id: spawns.at(-1)!.id, active: true })
      activeProc.emitData('z'.repeat(1024 * 1024))
      drain()

      const peak = getPtyRendererDeliveryDebugSnapshot().peakRendererInFlightChars
      expect(peak).toBeGreaterThan(
        PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS + PTY_RENDERER_INTERACTIVE_RESERVE_CHARS
      )
      expect(peak).toBeLessThanOrEqual(PTY_RENDERER_MAX_IN_FLIGHT_CHARS)
    } finally {
      vi.useRealTimers()
    }
  })
})
