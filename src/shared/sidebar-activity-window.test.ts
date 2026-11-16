import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from './constants'
import {
  DEFAULT_SIDEBAR_ACTIVITY_WINDOW_HOURS,
  SIDEBAR_ACTIVITY_WINDOW_HOURS,
  getSidebarActivityWindowMs
} from './sidebar-activity-window'

const HOUR = 60 * 60 * 1000

describe('getSidebarActivityWindowMs', () => {
  it('defaults to the owner-decided 24 h, also in the default settings', () => {
    expect(DEFAULT_SIDEBAR_ACTIVITY_WINDOW_HOURS).toBe(24)
    expect(getSidebarActivityWindowMs(undefined)).toBe(24 * HOUR)
    expect(getSidebarActivityWindowMs(getDefaultSettings('/home'))).toBe(24 * HOUR)
  })

  it('reads each offered window', () => {
    expect(SIDEBAR_ACTIVITY_WINDOW_HOURS).toEqual([12, 24, 72, 168])
    for (const hours of SIDEBAR_ACTIVITY_WINDOW_HOURS) {
      expect(getSidebarActivityWindowMs({ sidebarActivityWindowHours: hours })).toBe(hours * HOUR)
    }
  })

  it('falls back to 24 h for a value it does not offer, as a hand-edited profile may hold', () => {
    expect(getSidebarActivityWindowMs({ sidebarActivityWindowHours: 5 as never })).toBe(24 * HOUR)
  })
})
