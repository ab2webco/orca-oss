import type {
  MemoryPressureReading,
  MemoryPressureTrigger
} from '../../shared/memory-pressure-types'

/** How long a signal must hold, by readAt, before it opens a popup. */
export const MEMORY_PRESSURE_SUSTAIN_MS = 2 * 60_000
const EXIT_MARGIN_PERCENT = 5
// Why swap needs company: macOS keeps swap occupied long after pressure passes.
const SWAP_COMPANION_MARGIN_PERCENT = 10
const SWAP_ENTER_RATIO = 0.8
const SWAP_STAY_RATIO = 0.7

export function availablePercentOf(reading: MemoryPressureReading): number {
  return reading.totalMemory > 0 ? (reading.availableMemory / reading.totalMemory) * 100 : 100
}

/** macOS reports cache and compressed memory as unavailable, so its own pressure level is the signal there. */
export function isKernelAuthoritative(reading: MemoryPressureReading): boolean {
  return reading.source === 'sysctl'
}

function isKernelElevated(reading: MemoryPressureReading): boolean {
  return reading.kernelLevel === 'warn' || reading.kernelLevel === 'critical'
}

function isBelow(reading: MemoryPressureReading, percent: number): boolean {
  return reading.totalMemory > 0 && availablePercentOf(reading) < percent
}

/** One sample still under pressure: keeps an open popup alive, never opens one by itself. */
export function isReadingUnderPressure(
  reading: MemoryPressureReading,
  thresholdPercent: number
): boolean {
  if (reading.source === 'fallback') {
    return false
  }
  if (isKernelAuthoritative(reading)) {
    return isKernelElevated(reading)
  }
  return isBelow(reading, thresholdPercent + EXIT_MARGIN_PERCENT)
}

function heldFor(
  history: readonly MemoryPressureReading[],
  matches: (reading: MemoryPressureReading) => boolean
): boolean {
  const latest = history.at(-1)
  if (!latest || !matches(latest)) {
    return false
  }
  let runStart = latest.readAt
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const reading = history[index]
    if (reading.source !== latest.source || !matches(reading)) {
      break
    }
    runStart = reading.readAt
  }
  return latest.readAt - runStart >= MEMORY_PRESSURE_SUSTAIN_MS
}

/** A signal held over the sustain window. History must be gap-free and oldest first. */
export function findSustainedMemoryPressureTrigger(
  history: readonly MemoryPressureReading[],
  thresholdPercent: number
): MemoryPressureTrigger | null {
  const latest = history.at(-1)
  if (!latest || latest.source === 'fallback') {
    return null
  }
  if (isKernelAuthoritative(latest)) {
    return heldFor(history, isKernelElevated) ? 'kernel-pressure' : null
  }
  return heldFor(history, (reading) => isBelow(reading, thresholdPercent)) ? 'low-memory' : null
}

/** The pre-ORCA-691 single-sample rule, kept only to count the popups it would have opened. */
export function isLegacyMemoryPressureElevated(
  reading: MemoryPressureReading,
  thresholdPercent: number,
  wasElevated: boolean
): boolean {
  if (isKernelElevated(reading)) {
    return true
  }
  if (reading.totalMemory <= 0) {
    return false
  }
  const availablePercent = availablePercentOf(reading)
  const margin = wasElevated ? EXIT_MARGIN_PERCENT : 0
  if (availablePercent < thresholdPercent + margin) {
    return true
  }
  const swapRatio =
    reading.swapTotal && reading.swapUsed !== null ? reading.swapUsed / reading.swapTotal : 0
  return (
    swapRatio >= (wasElevated ? SWAP_STAY_RATIO : SWAP_ENTER_RATIO) &&
    availablePercent < thresholdPercent + SWAP_COMPANION_MARGIN_PERCENT + margin
  )
}
