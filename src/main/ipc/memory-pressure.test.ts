import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMemoryPressureHandlers } from './memory-pressure'
import type { MemoryPressureMonitor } from '../memory/memory-pressure-monitor'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}))

function monitorDouble() {
  return {
    getState: vi.fn(() => ({ warning: null })),
    dismiss: vi.fn(),
    refresh: vi.fn(async () => ({ warning: null }))
  } satisfies Pick<MemoryPressureMonitor, 'getState' | 'dismiss' | 'refresh'>
}

describe('registerMemoryPressureHandlers', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('serves the current state and an on-demand refresh', async () => {
    const monitor = monitorDouble()
    registerMemoryPressureHandlers(monitor)

    expect(handlers.get('memory:pressure:get')?.({})).toEqual({ warning: null })
    await handlers.get('memory:pressure:refresh')?.({})
    expect(monitor.refresh).toHaveBeenCalledTimes(1)
  })

  it('dismisses only a positive integer episode id', () => {
    const monitor = monitorDouble()
    registerMemoryPressureHandlers(monitor)
    const dismiss = handlers.get('memory:pressure:dismiss')

    for (const bad of ['1', -1, 0, 1.5, null, undefined, Number.NaN]) {
      dismiss?.({}, bad)
    }
    dismiss?.({}, 3)

    expect(monitor.dismiss.mock.calls).toEqual([[3]])
  })
})
