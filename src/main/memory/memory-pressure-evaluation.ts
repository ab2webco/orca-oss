import type { MemoryPressureReading } from '../../shared/memory-pressure-types'

const EXIT_MARGIN_PERCENT = 5
// Why swap needs company: macOS keeps swap occupied long after pressure passes.
const SWAP_COMPANION_MARGIN_PERCENT = 10
const SWAP_ENTER_RATIO = 0.8
const SWAP_STAY_RATIO = 0.7

export function isMemoryPressureElevated(
  reading: MemoryPressureReading,
  thresholdPercent: number,
  wasElevated: boolean
): boolean {
  if (reading.kernelLevel === 'warn' || reading.kernelLevel === 'critical') {
    return true
  }
  if (reading.totalMemory <= 0) {
    return false
  }
  const availablePercent = (reading.availableMemory / reading.totalMemory) * 100
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
