import { BAND_BUDGETS } from './band-mode'
import { frameWindowOf, percentileOf, type FrameWindow } from './frame-stats'

export type MeteredWindow = FrameWindow & { renderP50Ms: number; renderP95Ms: number }

/** Frame intervals and CPU render cost, collected per budget window. */
export const createFrameMeter = (): {
  add(intervalMs: number | null, renderMs: number): void
  isDue(now: number): boolean
  take(now: number): MeteredWindow
  reset(now: number): void
} => {
  let start = 0
  let intervals: number[] = []
  let costs: number[] = []
  return {
    add(intervalMs, renderMs) {
      if (intervalMs !== null) {
        intervals.push(intervalMs)
      }
      costs.push(renderMs)
    },
    isDue: (now) => now - start >= BAND_BUDGETS.windowMs,
    take(now) {
      const window = {
        ...frameWindowOf(intervals, now - start),
        renderP50Ms: percentileOf(costs, 50),
        renderP95Ms: percentileOf(costs, 95)
      }
      intervals = []
      costs = []
      start = now
      return window
    },
    reset(now) {
      intervals = []
      costs = []
      start = now
    }
  }
}
