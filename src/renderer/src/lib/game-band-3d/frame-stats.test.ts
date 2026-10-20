import { describe, expect, it } from 'vitest'
import { frameWindowOf, percentileOf } from './frame-stats'

describe('percentileOf', () => {
  it('returns the nearest-rank percentile', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentileOf(values, 50)).toBe(50)
    expect(percentileOf(values, 95)).toBe(95)
  })

  it('is zero for no samples', () => {
    expect(percentileOf([], 95)).toBe(0)
  })
})

describe('frameWindowOf', () => {
  it('turns frame intervals over a window into fps and frame-time percentiles', () => {
    const intervals = [...Array.from({ length: 56 }, () => 16), 40, 40, 40, 40]
    const window = frameWindowOf(intervals, 1000)
    expect(window.fps).toBe(60)
    expect(window.frameP50Ms).toBe(16)
    expect(window.frameP95Ms).toBe(40)
  })
})
