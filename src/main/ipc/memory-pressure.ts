import { ipcMain } from 'electron'
import type { MemoryPressureState } from '../../shared/memory-pressure-types'
import type { MemoryPressureMonitor } from '../memory/memory-pressure-monitor'

export const MEMORY_PRESSURE_CHANGED_CHANNEL = 'memory:pressure:changed'

export function registerMemoryPressureHandlers(
  monitor: Pick<MemoryPressureMonitor, 'getState' | 'dismiss' | 'refresh'>
): void {
  ipcMain.handle('memory:pressure:get', (): MemoryPressureState => monitor.getState())
  ipcMain.handle('memory:pressure:refresh', (): Promise<MemoryPressureState> => monitor.refresh())
  ipcMain.handle('memory:pressure:dismiss', (_event, episodeId: unknown): void => {
    if (typeof episodeId === 'number' && Number.isSafeInteger(episodeId) && episodeId > 0) {
      monitor.dismiss(episodeId)
    }
  })
}
