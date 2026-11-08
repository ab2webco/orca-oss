import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeFloatingTerminalTriggerClear } from './floating-terminal-trigger-keep-out'

// The Team dock at a 1440 x 900 window's bottom right while Stop asks (ORCA-1093).
const DOCK = { left: 1091, top: 770, right: 1440, bottom: 876 }

describe('placeFloatingTerminalTriggerClear', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('moves the button above the dock it would cover, keeping its column', () => {
    expect(placeFloatingTerminalTriggerClear({ left: 1380, top: 792 }, DOCK)).toEqual({
      left: 1380,
      top: 770 - 36 - 8
    })
  })

  it('leaves the button where it is when it does not touch the dock', () => {
    expect(placeFloatingTerminalTriggerClear({ left: 1380, top: 700 }, DOCK)).toEqual({
      left: 1380,
      top: 700
    })
    expect(placeFloatingTerminalTriggerClear({ left: 1000, top: 792 }, DOCK)).toEqual({
      left: 1000,
      top: 792
    })
  })

  it('leaves the button alone when no dock is shown', () => {
    expect(placeFloatingTerminalTriggerClear({ left: 1380, top: 792 }, null)).toEqual({
      left: 1380,
      top: 792
    })
  })

  it('stays below the title bar when the dock reaches the top', () => {
    const tall = { ...DOCK, top: 40 }
    expect(placeFloatingTerminalTriggerClear({ left: 1380, top: 100 }, tall).top).toBe(36)
  })
})
