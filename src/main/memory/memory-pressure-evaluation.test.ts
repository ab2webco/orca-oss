import { describe, expect, it } from 'vitest'
import type { MemoryPressureReading } from '../../shared/memory-pressure-types'
import {
  findSustainedMemoryPressureTrigger,
  isLegacyMemoryPressureElevated,
  isReadingUnderPressure
} from './memory-pressure-evaluation'
import {
  GIB,
  darwinReading,
  darwinSeries,
  linuxReading,
  linuxSeries
} from './memory-pressure-series.test-fixtures'

function reading(overrides: Partial<MemoryPressureReading>): MemoryPressureReading {
  return {
    totalMemory: 16 * GIB,
    availableMemory: 8 * GIB,
    swapTotal: null,
    swapUsed: null,
    kernelLevel: null,
    source: 'meminfo',
    readAt: 0,
    ...overrides
  }
}

function availablePercent(percent: number): Partial<MemoryPressureReading> {
  return { availableMemory: (16 * GIB * percent) / 100 }
}

describe('findSustainedMemoryPressureTrigger', () => {
  it('needs kernel warn or critical held for two minutes of readings', () => {
    const held = darwinSeries(Array.from({ length: 5 }, () => ({ level: 30, kernel: 'warn' })))

    expect(findSustainedMemoryPressureTrigger(held.slice(0, 4), 10)).toBeNull()
    expect(findSustainedMemoryPressureTrigger(held, 10)).toBe('kernel-pressure')
  })

  it('counts warn and critical as one run', () => {
    const run = darwinSeries([
      { level: 30, kernel: 'warn' },
      { level: 30, kernel: 'warn' },
      { level: 30, kernel: 'critical' },
      { level: 30, kernel: 'critical' },
      { level: 30, kernel: 'critical' }
    ])

    expect(findSustainedMemoryPressureTrigger(run, 10)).toBe('kernel-pressure')
  })

  it('restarts the run on a normal sample', () => {
    const broken = darwinSeries([
      { level: 30, kernel: 'warn' },
      { level: 30, kernel: 'warn' },
      { level: 30, kernel: 'normal' },
      { level: 30, kernel: 'warn' },
      { level: 30, kernel: 'warn' }
    ])

    expect(findSustainedMemoryPressureTrigger(broken, 10)).toBeNull()
  })

  it('never fires on the macOS level alone while the kernel reports a level', () => {
    const low = darwinSeries(Array.from({ length: 10 }, () => ({ level: 3 })))

    expect(findSustainedMemoryPressureTrigger(low, 10)).toBeNull()
  })

  it('fires on free memory held under the threshold where there is no kernel signal', () => {
    expect(findSustainedMemoryPressureTrigger(linuxSeries([9, 9, 9, 9, 9]), 10)).toBe('low-memory')
    expect(findSustainedMemoryPressureTrigger(linuxSeries([9, 9, 9, 9]), 10)).toBeNull()
    expect(findSustainedMemoryPressureTrigger(linuxSeries([9, 9, 11, 9, 9]), 10)).toBeNull()
    expect(findSustainedMemoryPressureTrigger(linuxSeries([14, 14, 14, 14, 14]), 15)).toBe(
      'low-memory'
    )
  })

  it('uses Windows free memory like any other reading', () => {
    const windows = linuxSeries([4, 4, 4, 4, 4]).map((r) => ({ ...r, source: 'freemem' as const }))

    expect(findSustainedMemoryPressureTrigger(windows, 10)).toBe('low-memory')
  })

  it('never fires on fallback readings, and a fallback breaks a run', () => {
    const fallback = linuxSeries([1, 1, 1, 1, 1]).map((r) => ({
      ...r,
      source: 'fallback' as const
    }))
    expect(findSustainedMemoryPressureTrigger(fallback, 10)).toBeNull()

    const mixed = linuxSeries([5, 5, 5, 5, 5])
    mixed[2] = { ...mixed[2], source: 'fallback' }
    expect(findSustainedMemoryPressureTrigger(mixed, 10)).toBeNull()
  })

  it('returns null for an empty history', () => {
    expect(findSustainedMemoryPressureTrigger([], 10)).toBeNull()
  })
})

describe('isReadingUnderPressure', () => {
  it('follows the kernel on macOS and the threshold plus margin elsewhere', () => {
    expect(isReadingUnderPressure(darwinReading({ level: 50, kernel: 'warn' }, 0), 10)).toBe(true)
    expect(isReadingUnderPressure(darwinReading({ level: 3 }, 0), 10)).toBe(false)
    expect(isReadingUnderPressure(linuxReading(14, 0), 10)).toBe(true)
    expect(isReadingUnderPressure(linuxReading(16, 0), 10)).toBe(false)
  })

  it('never counts a fallback reading', () => {
    expect(
      isReadingUnderPressure(reading({ ...availablePercent(1), source: 'fallback' }), 10)
    ).toBe(false)
  })
})

describe('isLegacyMemoryPressureElevated', () => {
  // Why this fixture: the live reading on the Mac this was built on. macOS keeps swap
  // occupied after pressure passes, so a swap-only rule would warn on a healthy machine.
  it('does not warn on full swap while the kernel says normal and 58% is free', () => {
    const live = reading({
      ...availablePercent(58),
      kernelLevel: 'normal',
      source: 'sysctl',
      swapTotal: 8192 * 1024 ** 2,
      swapUsed: 7310 * 1024 ** 2
    })

    expect(isLegacyMemoryPressureElevated(live, 10, false)).toBe(false)
    expect(isLegacyMemoryPressureElevated(live, 10, true)).toBe(false)
  })

  it('keeps the old single-sample rule for the before/after popup count', () => {
    const swapFull = { swapTotal: 4 * GIB, swapUsed: 3.5 * GIB }
    expect(isLegacyMemoryPressureElevated(reading(availablePercent(9)), 10, false)).toBe(true)
    expect(isLegacyMemoryPressureElevated(reading({ kernelLevel: 'warn' }), 10, false)).toBe(true)
    expect(
      isLegacyMemoryPressureElevated(reading({ ...swapFull, ...availablePercent(18) }), 10, false)
    ).toBe(true)
    expect(isLegacyMemoryPressureElevated(reading(availablePercent(13)), 10, true)).toBe(true)
    expect(isLegacyMemoryPressureElevated(reading(availablePercent(16)), 10, true)).toBe(false)
  })

  it('never warns on a reading with no total', () => {
    expect(
      isLegacyMemoryPressureElevated(reading({ totalMemory: 0, availableMemory: 0 }), 10, false)
    ).toBe(false)
  })
})
