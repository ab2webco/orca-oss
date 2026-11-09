import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { floatingTerminalLocationDefaultUpdates } from './floating-terminal-location-default'
import { FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY } from './floating-terminal-trigger-position'

function stubStorage(stored: unknown, options: { throws?: boolean } = {}): void {
  vi.stubGlobal('window', {
    innerWidth: 1200,
    innerHeight: 800,
    localStorage: {
      getItem: (key: string) => {
        if (options.throws) {
          throw new Error('storage blocked')
        }
        return key === FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY && stored !== undefined
          ? JSON.stringify(stored)
          : null
      }
    }
  })
}

const MOVED_TO_STATUS_BAR = {
  floatingTerminalTriggerLocation: 'status-bar' as const,
  floatingTerminalTriggerLocationDefaulted: true
}
const FLAG_ONLY = { floatingTerminalTriggerLocationDefaulted: true }

describe('floating terminal default location', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('puts a fresh profile in the status bar', () => {
    stubStorage(undefined)
    const fresh = getDefaultSettings('/home/user')
    expect(fresh.floatingTerminalTriggerLocation).toBe('status-bar')
    expect(fresh.floatingTerminalTriggerLocationDefaulted).toBeUndefined()
    expect(floatingTerminalLocationDefaultUpdates(fresh)).toEqual(FLAG_ONLY)
  })

  it('moves a profile that never placed the button to the status bar once', () => {
    stubStorage(undefined)
    const saved = { floatingTerminalTriggerLocation: 'floating-button' as const }
    expect(floatingTerminalLocationDefaultUpdates(saved)).toEqual(MOVED_TO_STATUS_BAR)
    expect(floatingTerminalLocationDefaultUpdates({ ...saved, ...MOVED_TO_STATUS_BAR })).toBeNull()
  })

  it('counts a stored position equal to the old default as never placed', () => {
    stubStorage({ anchorX: 'right', anchorY: 'bottom', offsetX: 24, offsetY: 72 })
    expect(
      floatingTerminalLocationDefaultUpdates({ floatingTerminalTriggerLocation: 'floating-button' })
    ).toEqual(MOVED_TO_STATUS_BAR)
  })

  it('leaves a dragged button where the user put it', () => {
    for (const dragged of [
      { anchorX: 'left', anchorY: 'top', offsetX: 40, offsetY: 120 },
      { anchorX: 'right', anchorY: 'bottom', offsetX: 24, offsetY: 200 },
      { left: 300, top: 200 }
    ]) {
      stubStorage(dragged)
      expect(
        floatingTerminalLocationDefaultUpdates({
          floatingTerminalTriggerLocation: 'floating-button'
        })
      ).toEqual(FLAG_ONLY)
    }
  })

  it('keeps a profile that moved back to floating after the migration', () => {
    stubStorage(undefined)
    expect(
      floatingTerminalLocationDefaultUpdates({
        floatingTerminalTriggerLocation: 'floating-button',
        floatingTerminalTriggerLocationDefaulted: true
      })
    ).toBeNull()
  })

  it('treats blocked storage as no position and still sets the flag', () => {
    stubStorage(undefined, { throws: true })
    expect(
      floatingTerminalLocationDefaultUpdates({ floatingTerminalTriggerLocation: 'floating-button' })
    ).toEqual(MOVED_TO_STATUS_BAR)
  })
})
