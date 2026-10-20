import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { setActivationPolicy, getPrimaryDisplay } = vi.hoisted(() => ({
  setActivationPolicy: vi.fn(),
  getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 25, width: 2560, height: 1415 } }))
}))

vi.mock('electron', () => ({
  app: { setActivationPolicy },
  screen: { getPrimaryDisplay }
}))

import { isE2EBackgroundWindow, revealE2EBackgroundWindow } from './e2e-background-window'

const windowStub = () => ({
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1440, height: 900 })),
  setFocusable: vi.fn(),
  setIgnoreMouseEvents: vi.fn(),
  setBounds: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  showInactive: vi.fn()
})

describe('e2e background window', () => {
  const original = process.env.ORCA_E2E_BACKGROUND_WINDOW

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.ORCA_E2E_BACKGROUND_WINDOW = original
  })

  it('is opt-in through its env flag', () => {
    delete process.env.ORCA_E2E_BACKGROUND_WINDOW
    expect(isE2EBackgroundWindow()).toBe(false)
    process.env.ORCA_E2E_BACKGROUND_WINDOW = '1'
    expect(isE2EBackgroundWindow()).toBe(true)
  })

  it('shows the window without focus or clicks, parked at the right edge', () => {
    const win = windowStub()
    revealE2EBackgroundWindow(win as never)
    expect(win.setFocusable).toHaveBeenCalledWith(false)
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(win.setBounds).toHaveBeenCalledWith({ x: 2536, y: 540, width: 1440, height: 900 })
    expect(win.showInactive).toHaveBeenCalledOnce()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
    // Why: focusability must be off before the window appears, or macOS can activate it.
    expect(win.setFocusable.mock.invocationCallOrder[0]).toBeLessThan(
      win.showInactive.mock.invocationCallOrder[0]
    )
  })

  it('keeps the app out of the Dock and app switcher on macOS', () => {
    revealE2EBackgroundWindow(windowStub() as never)
    expect(setActivationPolicy).toHaveBeenCalledTimes(process.platform === 'darwin' ? 1 : 0)
  })
})
