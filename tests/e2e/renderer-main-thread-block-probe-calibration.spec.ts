import { test, expect } from './helpers/orca-app'
import {
  readRendererBlockWindow,
  startRendererMainThreadBlockProbe,
  type RendererBlockWindow
} from './helpers/renderer-main-thread-block-probe'

/**
 * Calibration and regression guard for the renderer main-thread block probe.
 *
 * The freeze oracles decide `softFreeze` / `hardFreeze` from the single number
 * this instrument produces, so it needs both controls: an idle window it reads
 * low, and injected blocks of known size it reads at their size. Without the
 * positive control, a probe stuck at ~0 passes every freeze budget while
 * measuring nothing. The `setInterval(16)` predecessor runs over the identical
 * windows so the logged table records what it would have reported.
 * See docs/reference/timing-budget-assertions.md.
 */

const WINDOW_MS = 2_500
const INJECTED_BLOCK_MS = [0, 10, 40, 120] as const
/**
 * Idle ceiling — a hang detector for the instrument, not a precision budget;
 * the positive controls carry the precision. Deliberately loose rather than
 * fitted to the measured idle window: a control that flakes is worth less than
 * a loose one, and it still separates an idle renderer from the second-scale
 * block the bulk-open oracle reports (ORCA-230). Calibration data on ORCA-199.
 */
const MAX_IDLE_BLOCK_MS = 400
/**
 * The instrument's own error is under a millisecond; these tolerances exist for
 * unrelated renderer work landing in the same window — hence the upper bound
 * uses the idle window this run measured rather than a fixed guess.
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

  // Burn one window: the app is still settling after the test opened it, and
  // that lands in the idle control the tolerances below are read from.
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

  // Recorded on green too, so the thresholds stay defensible without a re-run.
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

  // Measured, not assumed: a loaded runner widens the upper bound below without
  // anyone raising a constant.
  const noiseAllowanceMs = Math.max(MIN_INJECTION_HEADROOM_MS, idle.block.maxBlockMs)

  for (const window of windows) {
    if (window.injectedBlockMs === 0) {
      continue
    }
    // Positive control: the lower bound is what proves the instrument sees a
    // real block at all — a probe stuck at 0 passes every freeze budget.
    expect(window.block.maxBlockMs).toBeGreaterThanOrEqual(
      window.injectedBlockMs * MIN_INJECTED_BLOCK_FRACTION
    )
    expect(window.block.maxBlockMs).toBeLessThan(window.injectedBlockMs + noiseAllowanceMs)
  }
})
