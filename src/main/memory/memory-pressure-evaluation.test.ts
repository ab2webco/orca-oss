import { describe, expect, it } from 'vitest'
import type { MemoryPressureReading } from '../../shared/memory-pressure-types'
import { isMemoryPressureElevated } from './memory-pressure-evaluation'

const GIB = 1024 ** 3

function reading(overrides: Partial<MemoryPressureReading>): MemoryPressureReading {
  return {
    totalMemory: 16 * GIB,
    availableMemory: 8 * GIB,
    swapTotal: null,
    swapUsed: null,
    kernelLevel: null,
    readAt: 0,
    ...overrides
  }
}

function availablePercent(percent: number): Partial<MemoryPressureReading> {
  return { availableMemory: (16 * GIB * percent) / 100 }
}

describe('isMemoryPressureElevated', () => {
  // Why this fixture: the live reading on the Mac this was built on. macOS keeps swap
  // occupied after pressure passes, so a swap-only rule would warn on a healthy machine.
  it('does not warn on full swap while the kernel says normal and 58% is free', () => {
    const live = reading({
      ...availablePercent(58),
      kernelLevel: 'normal',
      swapTotal: 8192 * 1024 ** 2,
      swapUsed: 7310 * 1024 ** 2
    })

    expect(isMemoryPressureElevated(live, 10, false)).toBe(false)
    expect(isMemoryPressureElevated(live, 10, true)).toBe(false)
  })

  it('warns when available memory falls under the threshold', () => {
    expect(isMemoryPressureElevated(reading(availablePercent(9)), 10, false)).toBe(true)
    expect(isMemoryPressureElevated(reading(availablePercent(11)), 10, false)).toBe(false)
    expect(isMemoryPressureElevated(reading(availablePercent(14)), 15, false)).toBe(true)
  })

  it('warns on the macOS kernel warn and critical levels whatever the free percent', () => {
    expect(isMemoryPressureElevated(reading({ kernelLevel: 'warn' }), 10, false)).toBe(true)
    expect(isMemoryPressureElevated(reading({ kernelLevel: 'critical' }), 10, false)).toBe(true)
  })

  it('counts nearly full swap only when available memory is also getting low', () => {
    const swapFull = { swapTotal: 4 * GIB, swapUsed: 3.5 * GIB }

    expect(
      isMemoryPressureElevated(reading({ ...swapFull, ...availablePercent(18) }), 10, false)
    ).toBe(true)
    expect(
      isMemoryPressureElevated(reading({ ...swapFull, ...availablePercent(25) }), 10, false)
    ).toBe(false)
  })

  it('stays elevated until available memory clears the threshold by five points', () => {
    expect(isMemoryPressureElevated(reading(availablePercent(13)), 10, true)).toBe(true)
    expect(isMemoryPressureElevated(reading(availablePercent(13)), 10, false)).toBe(false)
    expect(isMemoryPressureElevated(reading(availablePercent(16)), 10, true)).toBe(false)
  })

  it('never warns on a reading with no total', () => {
    expect(
      isMemoryPressureElevated(reading({ totalMemory: 0, availableMemory: 0 }), 10, false)
    ).toBe(false)
  })
})
