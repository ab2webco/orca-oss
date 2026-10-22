import { describe, expect, it } from 'vitest'
import { secondWorstLateTimerTickMs } from './hidden-pressure-timer-drift'

describe('secondWorstLateTimerTickMs', () => {
  const MAX_HIDDEN_PRESSURE_TIMER_DRIFT_MS = 3_000

  it('lets one isolated tick above the ceiling pass', () => {
    // The single sample that opened ORCA-752.
    expect(secondWorstLateTimerTickMs([3037])).toBeLessThan(MAX_HIDDEN_PRESSURE_TIMER_DRIFT_MS)
    expect(secondWorstLateTimerTickMs([120, 3037, 140])).toBeLessThan(
      MAX_HIDDEN_PRESSURE_TIMER_DRIFT_MS
    )
  })

  it('fails when two ticks are above the ceiling', () => {
    expect(secondWorstLateTimerTickMs([3037, 150, 3100])).not.toBeLessThan(
      MAX_HIDDEN_PRESSURE_TIMER_DRIFT_MS
    )
    expect(secondWorstLateTimerTickMs([3100, 3037])).toBe(3037)
  })

  it('reads no late ticks as no drift', () => {
    expect(secondWorstLateTimerTickMs([])).toBe(0)
  })

  it('does not reorder the recorded ticks', () => {
    const ticks = [150, 3100, 3037]
    secondWorstLateTimerTickMs(ticks)
    expect(ticks).toEqual([150, 3100, 3037])
  })
})
