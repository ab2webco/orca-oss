import type { MemoryPressureReading } from '../../shared/memory-pressure-types'

export const MEMORY_PRESSURE_TREND_WINDOW_MS = 5 * 60_000
const TREND_MIN_SPAN_MS = 4 * 60_000
const TREND_MIN_READINGS = 5
// Why: a cache that fills and drains also slopes down over part of a window; only a steady fall fits a line.
const TREND_MIN_FIT = 0.8

type Fit = { slope: number; fit: number }

function fitLine(points: readonly { x: number; y: number }[]): Fit {
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const p of points) {
    sxy += (p.x - meanX) * (p.y - meanY)
    sxx += (p.x - meanX) ** 2
    syy += (p.y - meanY) ** 2
  }
  if (sxx === 0) {
    return { slope: 0, fit: 0 }
  }
  return { slope: sxy / sxx, fit: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) }
}

/**
 * Minutes until available memory reaches zero at the rate of the last five minutes, counting
 * swap growth as demand. Null unless memory falls steadily; history must be gap-free, oldest first.
 */
export function estimateMinutesToExhaustion(
  history: readonly MemoryPressureReading[]
): number | null {
  const latest = history.at(-1)
  if (!latest || latest.source === 'fallback' || latest.totalMemory <= 0) {
    return null
  }
  const window = history.filter(
    (reading) =>
      reading.source === latest.source &&
      reading.readAt >= latest.readAt - MEMORY_PRESSURE_TREND_WINDOW_MS
  )
  const first = window[0]
  if (window.length < TREND_MIN_READINGS || latest.readAt - first.readAt < TREND_MIN_SPAN_MS) {
    return null
  }
  const available = fitLine(window.map((r) => ({ x: r.readAt, y: r.availableMemory })))
  if (available.slope >= 0 || available.fit < TREND_MIN_FIT) {
    return null
  }
  const hasSwap = window.every((r) => r.swapUsed !== null)
  const swapSlope = hasSwap
    ? fitLine(window.map((r) => ({ x: r.readAt, y: r.swapUsed ?? 0 }))).slope
    : 0
  // Why: on macOS a level falls as the cache fills too; only paging out to swap means real demand.
  if (latest.source === 'sysctl' && !(swapSlope > 0)) {
    return null
  }
  const drainPerMs = -available.slope + Math.max(0, swapSlope)
  return latest.availableMemory / drainPerMs / 60_000
}
