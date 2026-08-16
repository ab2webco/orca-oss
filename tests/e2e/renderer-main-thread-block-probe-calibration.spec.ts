import { test, expect } from './helpers/orca-app'
import {
  readRendererBlockWindow,
  startRendererMainThreadBlockProbe,
  type RendererBlockWindow
} from './helpers/renderer-main-thread-block-probe'

/**
 * Calibration and regression guard for the renderer main-thread block probe
 * (ORCA-199).
 *
 * The freeze oracles decide `softFreeze` / `hardFreeze` from a single number
 * this instrument produces, so the instrument itself needs both controls: an
 * idle window it reads low, and injected blocks of known size it reads at their
 * size. Without the positive control a probe that always returns ~0 passes
 * every freeze budget while measuring nothing — which is not hypothetical, it
 * is how the `setInterval(16)` probe this replaces passed two `< 500ms`
 * paired-terminal budgets.
 *
 * That predecessor runs over the identical windows here, so the calibration
 * table also records what it would have reported. See
 * docs/reference/timing-budget-assertions.md.
 */

const WINDOW_MS = 2_500
const INJECTED_BLOCK_MS = [0, 10, 40, 120] as const
/**
 * Idle ceiling — a hang detector for the instrument itself, not a precision
 * budget: the positive controls below carry the precision. Measured 5.6ms and
 * 19.7ms over two local idle windows on a 10-core M-series, so the run-to-run
 * spread on the best hardware in play is already 3.5x and a tight ceiling would
 * flake on a shared runner. 250 still separates an idle renderer from the
 * ~1010ms the bulk-open oracle reports, which is the claim this control has to
 * support.
 */
const MAX_IDLE_BLOCK_MS = 250
/**
 * Injected blocks measured 10.2 / 40.0 / 120.1ms for 10 / 40 / 120ms injected.
 * The instrument is accurate to well under a millisecond; these tolerances
 * exist for runner noise landing inside the same window, not for instrument
 * error.
 */
const MIN_INJECTED_BLOCK_FRACTION = 0.8
const MAX_INJECTION_OVERHEAD_MS = 40
type LegacyDriftWindow = {
  maxDriftMs: number
  tickCount: number
  windowMs: number
}

type CalibrationWindow = {
  injectedBlockMs: number
  block: RendererBlockWindow
  legacy: LegacyDriftWindow
}

test('renderer block probe reads injected main-thread blocks at their size', async ({
  orcaPage
}) => {
  test.setTimeout(120_000)

  const windows: CalibrationWindow[] = []
  for (const injectedBlockMs of INJECTED_BLOCK_MS) {
    // The instrument under test, and beside it the one it replaces — same
    // window, same load, so the comparison needs no cross-run assumption.
    const blockProbe = await startRendererMainThreadBlockProbe(orcaPage)
    const legacyProbe = await orcaPage.evaluateHandle(() => {
      const sampleMs = 16
      const startedAt = performance.now()
      let lastAt = startedAt
      let maxDriftMs = 0
      let tickCount = 0
      const timer = window.setInterval(() => {
        const now = performance.now()
        tickCount += 1
        maxDriftMs = Math.max(maxDriftMs, now - lastAt - sampleMs)
        lastAt = now
      }, sampleMs)
      return {
        stop: () => {
          window.clearInterval(timer)
          return { maxDriftMs, tickCount, windowMs: performance.now() - startedAt }
        }
      }
    })

    await orcaPage.waitForTimeout(WINDOW_MS / 2)
    if (injectedBlockMs > 0) {
      await orcaPage.evaluate((blockMs) => {
        const until = performance.now() + blockMs
        while (performance.now() < until) {
          // Deliberate main-thread block of known size.
        }
      }, injectedBlockMs)
    }
    await orcaPage.waitForTimeout(WINDOW_MS / 2)

    const block = await readRendererBlockWindow(blockProbe, `injected=${injectedBlockMs}ms`)
    const legacy = await legacyProbe.evaluate((probe) => probe.stop())
    await blockProbe.dispose()
    await legacyProbe.dispose()
    windows.push({ injectedBlockMs, block, legacy })
  }

  // Recorded on green too: every instance of this class in this repo was
  // unreadable until someone re-ran it by hand.
  console.log(
    '[block-probe calibration]',
    JSON.stringify(
      windows.map((window) => ({
        injectedBlockMs: window.injectedBlockMs,
        blockMaxMs: Number(window.block.maxBlockMs.toFixed(1)),
        blockSamples: window.block.sampleCount,
        legacyDriftMs: Number(window.legacy.maxDriftMs.toFixed(1)),
        legacyTicks: window.legacy.tickCount,
        windowMs: Number(window.block.windowMs.toFixed(0))
      })),
      null,
      2
    )
  )

  for (const window of windows) {
    if (window.injectedBlockMs === 0) {
      // Negative control: the instrument must read an idle renderer low, or a
      // freeze budget built on it fails on the instrument's own cost.
      expect(window.block.maxBlockMs).toBeLessThan(MAX_IDLE_BLOCK_MS)
      continue
    }
    // Positive control: a block of known size has to read as its size.
    expect(window.block.maxBlockMs).toBeGreaterThanOrEqual(
      window.injectedBlockMs * MIN_INJECTED_BLOCK_FRACTION
    )
    expect(window.block.maxBlockMs).toBeLessThan(window.injectedBlockMs + MAX_INJECTION_OVERHEAD_MS)
  }
})
