// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import { FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY } from './floating-terminal-trigger-position'

const store = vi.hoisted(() => ({
  settings: null as Partial<GlobalSettings> | null,
  updateSettings: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: typeof store) => T): T => selector(store)
}))

const { useFloatingTerminalLocationDefault } = await import('./floating-terminal-location-default')

describe('useFloatingTerminalLocationDefault', () => {
  beforeEach(() => {
    window.localStorage.clear()
    store.settings = null
    store.updateSettings = vi.fn(async (updates: Partial<GlobalSettings>) => {
      store.settings = { ...store.settings, ...updates }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('waits for settings, then moves a never-placed profile once', async () => {
    const { rerender } = renderHook(() => useFloatingTerminalLocationDefault())
    expect(store.updateSettings).not.toHaveBeenCalled()

    store.settings = { floatingTerminalTriggerLocation: 'floating-button' }
    await act(async () => rerender())
    await act(async () => rerender())
    expect(store.updateSettings).toHaveBeenCalledTimes(1)
    expect(store.settings).toEqual({
      floatingTerminalTriggerLocation: 'status-bar',
      floatingTerminalTriggerLocationDefaulted: true
    })
  })

  it('never moves the button again once the user chose floating after the migration', async () => {
    store.settings = {
      floatingTerminalTriggerLocation: 'floating-button',
      floatingTerminalTriggerLocationDefaulted: true
    }
    const { rerender } = renderHook(() => useFloatingTerminalLocationDefault())
    await act(async () => rerender())
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('only marks a dragged profile', async () => {
    window.localStorage.setItem(
      FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY,
      JSON.stringify({ left: 300, top: 200 })
    )
    store.settings = { floatingTerminalTriggerLocation: 'floating-button' }
    renderHook(() => useFloatingTerminalLocationDefault())
    await act(async () => {})
    expect(store.updateSettings).toHaveBeenCalledWith({
      floatingTerminalTriggerLocationDefaulted: true
    })
    expect(store.settings.floatingTerminalTriggerLocation).toBe('floating-button')
  })
})
