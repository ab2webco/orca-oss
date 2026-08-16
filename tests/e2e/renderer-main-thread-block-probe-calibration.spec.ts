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
 * Idle ceiling — a hang detector for the instrument, not a precision budget:
 * the positive controls carry the precision. The window is only idle in the
 * sense that this spec injects nothing into it; a booted Orca renderer is still
 * running. Measured 5.6 / 19.7 / 24.6ms locally on a 10-core M-series and
 * 74.4 / 106.0ms on 2-core CI runners, so a tight ceiling is a flake. 400 keeps
 * ~3.8x over the worst measured and still separates an idle renderer from the
 * ~1018ms the bulk-open oracle reports, which is the claim this control exists
 * to support.
 */
const MAX_IDLE_BLOCK_MS = 400
/**
 * Injected blocks measured 10.2-12.0 / 40.0-40.3 / 120.1-120.7ms for
 * 10 / 40 / 120ms injected, across local and CI. The instrument's own error is
 * under a millisecond; the tolerances exist for unrelated renderer work landing
 * in the same window, which is why the upper bound is allowed the idle window
 * this run actually measured rather than a fixed guess.
 */
const MIN_INJECTED_BLOCK_FRACTION = 0.8
const MIN_INJECTION_HEADROOM_MS = 40
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

  // Why: across four CI and local sweeps the first window's worst block always
  // landed in its first ~150ms (+128, +141, +146ms) — the app still settling
  // after the test opened it, not anything this spec injected. Burning one
  // window keeps that out of the idle control the tolerances below are read
  // from.
  await orcaPage.waitForTimeout(WINDOW_MS)

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

  const idle = windows.find((window) => window.injectedBlockMs === 0)
  if (!idle) {
    throw new Error('calibration sweep lost its idle control')
  }
  // Negative control: the instrument must read a renderer nobody blocked low,
  // or a freeze budget built on it fails on the instrument's own cost.
  expect(idle.block.maxBlockMs).toBeLessThan(MAX_IDLE_BLOCK_MS)

  // How much unrelated renderer work this particular runner puts in a window of
  // this length — measured, not assumed, so a loaded runner widens the upper
  // bound below without anyone raising a constant.
  const noiseAllowanceMs = Math.max(MIN_INJECTION_HEADROOM_MS, idle.block.maxBlockMs)

  for (const window of windows) {
    if (window.injectedBlockMs === 0) {
      continue
    }
    // Positive control: a block of known size has to read as its size. The
    // lower bound is the one that proves the instrument sees a real block at
    // all — a probe stuck at 0 passes every freeze budget ever written.
    expect(window.block.maxBlockMs).toBeGreaterThanOrEqual(
      window.injectedBlockMs * MIN_INJECTED_BLOCK_FRACTION
    )
    expect(window.block.maxBlockMs).toBeLessThan(window.injectedBlockMs + noiseAllowanceMs)
  }
})
