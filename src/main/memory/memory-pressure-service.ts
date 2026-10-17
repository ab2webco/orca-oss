import { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveMemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import { MEMORY_PRESSURE_CHANGED_CHANNEL } from '../ipc/memory-pressure'
import { collectMemorySnapshot } from './collector'
import { MemoryPressureMonitor } from './memory-pressure-monitor'
import { rankMemoryPressurePanes } from './memory-pressure-panes'
import { readMemoryPressure } from './memory-pressure-reading'

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
    collectPanes: async () =>
      rankMemoryPressurePanes(await collectMemorySnapshot(store), (sessionId) =>
        runtime.getPtyLastOutputAt(sessionId)
      ),
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
