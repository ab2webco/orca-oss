import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_PRESSURE_THRESHOLD_PERCENT,
  MEMORY_PRESSURE_THRESHOLD_CHOICES,
  resolveMemoryPressureWarningSettings
} from './memory-pressure-settings'

describe('resolveMemoryPressureWarningSettings', () => {
  it('is on at 10% for a profile that predates the setting', () => {
    expect(resolveMemoryPressureWarningSettings({})).toEqual({
      enabled: true,
      thresholdPercent: DEFAULT_MEMORY_PRESSURE_THRESHOLD_PERCENT
    })
    expect(DEFAULT_MEMORY_PRESSURE_THRESHOLD_PERCENT).toBe(10)
  })

  it('keeps an explicit opt-out and a listed threshold', () => {
    expect(
      resolveMemoryPressureWarningSettings({
        memoryPressureWarningEnabled: false,
        memoryPressureWarningThresholdPercent: 20
      })
    ).toEqual({ enabled: false, thresholdPercent: 20 })
  })

  it('falls back to the default for a threshold outside the choices', () => {
    for (const stored of [0, 3, 99, Number.NaN, -10]) {
      expect(
        resolveMemoryPressureWarningSettings({ memoryPressureWarningThresholdPercent: stored })
          .thresholdPercent
      ).toBe(DEFAULT_MEMORY_PRESSURE_THRESHOLD_PERCENT)
    }
    expect(MEMORY_PRESSURE_THRESHOLD_CHOICES).toEqual([5, 10, 15, 20])
  })
})
