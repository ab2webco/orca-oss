import type { GlobalSettings } from './global-settings-types'

export const MEMORY_PRESSURE_THRESHOLD_CHOICES = [5, 10, 15, 20] as const
export const DEFAULT_MEMORY_PRESSURE_THRESHOLD_PERCENT = 10

export type MemoryPressureWarningSettings = {
  enabled: boolean
  /** Warn when available memory falls below this percent of physical memory. */
  thresholdPercent: number
}

export function isMemoryPressureThresholdChoice(value: unknown): value is number {
  return MEMORY_PRESSURE_THRESHOLD_CHOICES.some((choice) => choice === value)
}

export function resolveMemoryPressureWarningSettings(
  settings: Partial<
    Pick<GlobalSettings, 'memoryPressureWarningEnabled' | 'memoryPressureWarningThresholdPercent'>
  >
): MemoryPressureWarningSettings {
  const stored = settings.memoryPressureWarningThresholdPercent
  return {
    enabled: settings.memoryPressureWarningEnabled !== false,
    thresholdPercent: isMemoryPressureThresholdChoice(stored)
      ? stored
      : DEFAULT_MEMORY_PRESSURE_THRESHOLD_PERCENT
  }
}
