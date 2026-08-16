import { describe, expect, it, vi } from 'vitest'
import {
  formatBlockWindow,
  readRendererBlockWindow,
  type RendererBlockWindow,
  type RendererMainThreadBlockProbe
} from './renderer-main-thread-block-probe'

function probeReturning(window: RendererBlockWindow): RendererMainThreadBlockProbe {
  return { evaluate: async () => window } as unknown as RendererMainThreadBlockProbe
}

describe('readRendererBlockWindow', () => {
  // Why this test exists: the guard is the whole reason the freeze budgets can
  // be trusted. A probe that never ticked reports maxBlockMs 0, which reads as
  // a perfectly responsive renderer, so every budget built on it passes while
  // observing nothing.
  it('rejects a window whose probe never ticked', async () => {
    await expect(
      readRendererBlockWindow(
        probeReturning({ maxBlockMs: 0, maxBlockAtMs: 0, sampleCount: 0, windowMs: 2_000 }),
        'dead probe'
      )
    ).rejects.toThrow(/dead probe .*did not tick .*measured nothing/s)
  })

  it('rejects a window with a single tick, which yields no measured gap', async () => {
    await expect(
      readRendererBlockWindow(
        probeReturning({ maxBlockMs: 0.2, maxBlockAtMs: 0, sampleCount: 1, windowMs: 2_000 }),
        'one tick'
      )
    ).rejects.toThrow(/did not tick/)
  })

  it('returns a live window and records it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const window = await readRendererBlockWindow(
        probeReturning({
          maxBlockMs: 1_017.8,
          maxBlockAtMs: 6_119.9,
          sampleCount: 728_779,
          windowMs: 12_281
        }),
        'bulk open'
      )
      expect(window.maxBlockMs).toBe(1_017.8)
      expect(log).toHaveBeenCalledWith(
        '[block-probe]',
        'bulk open block=1017.8ms at +6120ms over 12281ms (728779 samples)'
      )
    } finally {
      log.mockRestore()
    }
  })

  // A real freeze is few samples with maxBlockMs covering the window; that has
  // to report, not throw, or the oracle turns its own signal into an error.
  it('returns a window that spent almost all of itself blocked', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const window = await readRendererBlockWindow(
        probeReturning({
          maxBlockMs: 1_980,
          maxBlockAtMs: 10,
          sampleCount: 3,
          windowMs: 2_000
        }),
        'frozen'
      )
      expect(window.maxBlockMs).toBe(1_980)
    } finally {
      log.mockRestore()
    }
  })
})

describe('formatBlockWindow', () => {
  it('keeps the sample count, so a suspicious reading can be checked against it', () => {
    expect(
      formatBlockWindow(
        { maxBlockMs: 1.05, maxBlockAtMs: 266.7, sampleCount: 111_567, windowMs: 528.4 },
        'hidden paired flood'
      )
    ).toBe('hidden paired flood block=1.1ms at +267ms over 528ms (111567 samples)')
  })
})
