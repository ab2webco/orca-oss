import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDisposableEffectTimers } from './disposable-effect-timers'

describe('createDisposableEffectTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires added timers at their delay while not disposed', () => {
    const timers = createDisposableEffectTimers()
    const fn = vi.fn()
    timers.add(fn, 100)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('clears every pending timer on dispose', () => {
    const timers = createDisposableEffectTimers()
    const first = vi.fn()
    const second = vi.fn()
    timers.add(first, 100)
    timers.add(second, 200)
    timers.dispose()
    vi.runAllTimers()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('ignores add after dispose', () => {
    const timers = createDisposableEffectTimers()
    timers.dispose()
    const fn = vi.fn()
    timers.add(fn, 0)
    vi.runAllTimers()
    expect(fn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
