import { describe, expect, it } from 'vitest'
import { estimateMinutesToExhaustion } from './memory-pressure-trend'
import {
  CACHE_HEAVY_MAC_HOUR,
  CACHE_SWING_MAC_HOUR,
  FALLING_MAC,
  FLAT_LOW_MAC,
  darwinSeries,
  linuxSeries
} from './memory-pressure-series.test-fixtures'

describe('estimateMinutesToExhaustion', () => {
  it('predicts a short time on a steady fall with swap growing', () => {
    const minutes = estimateMinutesToExhaustion(darwinSeries(FALLING_MAC.slice(0, 10)))

    expect(minutes).not.toBeNull()
    expect(minutes!).toBeGreaterThan(5)
    expect(minutes!).toBeLessThan(10)
  })

  it('predicts nothing for a flat low level', () => {
    expect(estimateMinutesToExhaustion(darwinSeries(FLAT_LOW_MAC.slice(0, 10)))).toBeNull()
    expect(estimateMinutesToExhaustion(linuxSeries(Array.from({ length: 10 }, () => 5)))).toBeNull()
  })

  it('predicts nothing on any window of the cache-heavy macOS series', () => {
    for (const fixture of [CACHE_HEAVY_MAC_HOUR, CACHE_SWING_MAC_HOUR]) {
      const series = darwinSeries(fixture)
      for (let end = 1; end <= series.length; end += 1) {
        expect(estimateMinutesToExhaustion(series.slice(Math.max(0, end - 10), end))).toBeNull()
      }
    }
  })

  it('ignores an oscillation on Linux, where swap does not have to grow', () => {
    const oscillating = linuxSeries([20, 16, 12, 8, 12, 16, 20, 16, 12, 8])

    expect(estimateMinutesToExhaustion(oscillating)).toBeNull()
  })

  it('needs a macOS fall to come with swap growth', () => {
    const fallNoSwap = darwinSeries(
      FALLING_MAC.slice(0, 10).map((sample) => ({ ...sample, swapUsedMiB: 4000 }))
    )

    expect(estimateMinutesToExhaustion(fallNoSwap)).toBeNull()
  })

  it('predicts a steady Linux fall without swap growth', () => {
    const minutes = estimateMinutesToExhaustion(
      linuxSeries([30, 28, 26, 24, 22, 20, 18, 16, 14, 12])
    )

    expect(minutes).toBeCloseTo(3, 0)
  })

  it('needs four minutes of readings', () => {
    expect(estimateMinutesToExhaustion(darwinSeries(FALLING_MAC.slice(0, 8)))).toBeNull()
    expect(estimateMinutesToExhaustion(darwinSeries(FALLING_MAC.slice(0, 9)))).not.toBeNull()
  })

  it('never predicts from a fallback reading', () => {
    const series = linuxSeries([30, 28, 26, 24, 22, 20, 18, 16, 14, 12])
    series.push({ ...series.pop()!, source: 'fallback' })

    expect(estimateMinutesToExhaustion(series)).toBeNull()
  })

  it('reads only the last five minutes', () => {
    const series = linuxSeries([
      60,
      55,
      50,
      45,
      40,
      35,
      30,
      25,
      20,
      15,
      ...Array.from({ length: 10 }, () => 15)
    ])

    expect(estimateMinutesToExhaustion(series)).toBeNull()
  })
})
