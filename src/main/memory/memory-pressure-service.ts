import { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveMemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import { MEMORY_PRESSURE_CHANGED_CHANNEL } from '../ipc/memory-pressure'
import { collectMemorySnapshot } from './collector'
import { MemoryPressureMonitor } from './memory-pressure-monitor'
import { rankMemoryPressurePanes } from './memory-pressure-panes'
import { readMemoryPressure } from './memory-pressure-reading'
import { listRegisteredPtys } from './pty-registry'

type MemoryPressureStore = Pick<
  Store,
  'getSettings' | 'onSettingsChanged' | 'getRepo' | 'getWorktreeMeta'
>

export function createMemoryPressureService(
  store: MemoryPressureStore,
  runtime: Pick<OrcaRuntimeService, 'getPtyLastOutputAt'>
): { monitor: MemoryPressureMonitor; dispose: () => void } {
  const monitor = new MemoryPressureMonitor({
    readPressure: () => readMemoryPressure(),
    // Why the shared collector: it coalesces with the Resource Manager's poll into one ps/top sweep.
    collectPanes: async () => {
      const snapshot = await collectMemorySnapshot(store)
      // Why: the collector keys sessions by registry session id, which can differ from the PTY id.
      const ptyIdBySession = new Map(
        listRegisteredPtys().map((pty) => [pty.sessionId ?? pty.ptyId, pty.ptyId])
      )
      return rankMemoryPressurePanes(snapshot, (sessionId) => {
        const ptyId = ptyIdBySession.get(sessionId) ?? sessionId
        return { ptyId, lastOutputAt: runtime.getPtyLastOutputAt(ptyId) }
      })
    },
    getSettings: () => resolveMemoryPressureWarningSettings(store.getSettings()),
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(MEMORY_PRESSURE_CHANGED_CHANNEL, state)
        }
      }
    }
  })
  const disposeSettings = store.onSettingsChanged((updates) => {
    if (
      'memoryPressureWarningEnabled' in updates ||
      'memoryPressureWarningThresholdPercent' in updates
    ) {
      monitor.applySettings()
      void monitor.tick()
    }
  })
  return {
    monitor,
    dispose: () => {
      disposeSettings()
      monitor.stop()
    }
  }
}
