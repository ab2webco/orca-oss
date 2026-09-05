import { afterEach, describe, expect, it, vi } from 'vitest'
import { settlePairedCleanupCall } from './paired-cleanup-call-budget'

afterEach(() => {
  vi.useRealTimers()
})

describe('settlePairedCleanupCall', () => {
  it('gives up on a call that never settles', async () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    const pending = settlePairedCleanupCall(new Promise<never>(() => {}), 5_000).then(settled)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejected call exactly like the unbounded cleanup did', async () => {
    await expect(
      settlePairedCleanupCall(Promise.reject(new Error('terminal_gone')))
    ).resolves.toBeUndefined()
  })

  it('lets the original failure surface instead of a suite timeout', async () => {
    vi.useFakeTimers()
    const hungCall = new Promise<never>(() => {})
    const run = (async () => {
      try {
        throw new Error('Client never mirrored host tab')
      } finally {
        await settlePairedCleanupCall(hungCall, 5_000)
      }
    })()

    const assertion = expect(run).rejects.toThrow('Client never mirrored host tab')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
  })
})
