import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { MemoryPressureReading } from '../../shared/memory-pressure-types'
import type { PtyRegistration } from './pty-registry'

const GIB = 1024 ** 3

const { windowsMock, readMemoryPressureMock, collectMemorySnapshotMock, listRegisteredPtysMock } =
  vi.hoisted(() => ({
    windowsMock: vi.fn(),
    readMemoryPressureMock: vi.fn(),
    collectMemorySnapshotMock: vi.fn(),
    listRegisteredPtysMock: vi.fn((): PtyRegistration[] => [])
  }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: windowsMock }
}))
vi.mock('./memory-pressure-reading', () => ({ readMemoryPressure: readMemoryPressureMock }))
vi.mock('./collector', () => ({ collectMemorySnapshot: collectMemorySnapshotMock }))
vi.mock('./pty-registry', () => ({ listRegisteredPtys: listRegisteredPtysMock }))

const TICK_MS = 30_000
// Why four ticks after the first: the low-memory rule needs two minutes of readings.
const SUSTAINED_MS = 4 * TICK_MS

function lowMemory(): MemoryPressureReading {
  return {
    totalMemory: 16 * GIB,
    availableMemory: GIB / 2,
    swapTotal: null,
    swapUsed: null,
    kernelLevel: null,
    source: 'meminfo',
    readAt: Date.now()
  }
}

function storeDouble(initial: Partial<GlobalSettings>) {
  let settings = initial
  type Listener = (updates: Partial<GlobalSettings>, settings: GlobalSettings) => void
  const listeners = new Set<Listener>()
  return {
    getSettings: () => settings as GlobalSettings,
    getRepo: () => undefined,
    getWorktreeMeta: () => undefined,
    onSettingsChanged: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    change: (updates: Partial<GlobalSettings>) => {
      settings = { ...settings, ...updates }
      for (const listener of listeners) {
        listener(updates, settings as GlobalSettings)
      }
    }
  }
}

describe('createMemoryPressureService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    readMemoryPressureMock.mockReset()
    collectMemorySnapshotMock.mockReset()
    windowsMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the warning to every live window with panes ranked from the snapshot', async () => {
    const live = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const gone = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    windowsMock.mockReturnValue([live, gone])
    // Why: the registry's session id can differ from the live PTY id that idle time is keyed by.
    listRegisteredPtysMock.mockReturnValue([
      { ptyId: 'pty-live', worktreeId: 'repo::/w', sessionId: 'sess-1', paneKey: null, pid: 1 }
    ])
    readMemoryPressureMock.mockImplementation(async () => lowMemory())
    collectMemorySnapshotMock.mockResolvedValue({
      processMemoryMetric: 'rss',
      worktrees: [
        {
          worktreeId: 'repo::/w',
          worktreeName: 'w',
          repoName: 'repo',
          sessions: [{ sessionId: 'sess-1', paneKey: null, pid: 1, cpu: 0, memory: GIB }]
        }
      ]
    })
    const { createMemoryPressureService } = await import('./memory-pressure-service')

    const service = createMemoryPressureService(storeDouble({}), {
      getPtyLastOutputAt: (id) => (id === 'pty-live' ? 42 : null)
    })
    service.monitor.start()
    await vi.advanceTimersByTimeAsync(SUSTAINED_MS)

    const sent = live.webContents.send.mock.calls.at(-1)
    expect(sent?.[0]).toBe('memory:pressure:changed')
    expect(sent?.[1].warning.panes).toEqual([
      expect.objectContaining({
        sessionId: 'sess-1',
        ptyId: 'pty-live',
        memory: GIB,
        lastOutputAt: 42
      })
    ])
    expect(gone.webContents.send).not.toHaveBeenCalled()
    service.dispose()
  })

  it('stops sampling as soon as the setting is turned off', async () => {
    windowsMock.mockReturnValue([])
    readMemoryPressureMock.mockImplementation(async () => ({
      ...lowMemory(),
      availableMemory: 8 * GIB
    }))
    const store = storeDouble({})
    const { createMemoryPressureService } = await import('./memory-pressure-service')

    const service = createMemoryPressureService(store, { getPtyLastOutputAt: () => null })
    service.monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    store.change({ memoryPressureWarningEnabled: false })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(readMemoryPressureMock).toHaveBeenCalledTimes(1)
    service.dispose()
  })
})
