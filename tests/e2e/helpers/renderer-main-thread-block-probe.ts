import type { JSHandle, Page } from '@stablyai/playwright-test'

/** One measurement window of the renderer's main thread. */
export type RendererBlockWindow = {
  /** Longest interval the main thread went without servicing a posted task. */
  maxBlockMs: number
  /** Offset of that block from the window start, so it can be located in the run. */
  maxBlockAtMs: number
  /** Tasks the sampler serviced. Near-zero means the instrument, not the renderer, was dead. */
  sampleCount: number
  windowMs: number
}

export type RendererMainThreadBlockProbe = JSHandle<{ stop: () => RendererBlockWindow }>

/** A window with fewer ticks than this measured nothing; see assertBlockWindowMeasured. */
const MIN_MEASURED_SAMPLES = 2

/**
 * Longest stretch the renderer's main thread went without servicing a task.
 *
 * Why not `setInterval` (ORCA-199), which is what the freeze oracles used
 * before: a 16ms drift probe cannot resolve a block shorter than its own
 * period and under-reports the ones it does catch (a 120ms injected block read
 * 109.4ms beside this probe's 120.1ms), and — the part that decided the swap —
 * a window in which the timer never fired reports `0`, which is
 * indistinguishable from a perfectly responsive renderer. Two paired-terminal
 * budgets were asserting `< 500ms` against exactly that.
 *
 * Why not `requestAnimationFrame` (ORCA-197, ORCA-220): the E2E window is never
 * shown, so Chromium produces no compositor frames for it and rAF fires at ~1Hz
 * or not at all — a double-rAF probe read 1914ms on a responsive renderer.
 *
 * MessagePort tasks carry neither dependency: they are ordinary macrotasks, not
 * tied to a frame and not subject to timer clamping. Ticking one and keeping
 * the longest gap between turns sees every task the renderer runs, wherever in
 * the window it lands — the property a single sample lacks (ORCA-222: a
 * deliberate 60ms freeze read 1.4ms on a one-shot timer that missed it).
 *
 * Calibrated in renderer-main-thread-block-probe-calibration.spec.ts: 10 / 40 /
 * 120ms injected blocks read 10.2 / 40.0 / 120.1ms, an idle window 5.6ms.
 */
export async function startRendererMainThreadBlockProbe(
  page: Page
): Promise<RendererMainThreadBlockProbe> {
  return page.evaluateHandle(() => {
    const channel = new MessageChannel()
    const startedAt = performance.now()
    let lastTickAt = startedAt
    let maxBlockMs = 0
    let maxBlockAtMs = 0
    let sampleCount = 0
    let running = true
    let stopped: {
      maxBlockMs: number
      maxBlockAtMs: number
      sampleCount: number
      windowMs: number
    } | null = null
    channel.port1.onmessage = (): void => {
      const now = performance.now()
      const gapMs = now - lastTickAt
      sampleCount += 1
      if (gapMs > maxBlockMs) {
        maxBlockMs = gapMs
        maxBlockAtMs = lastTickAt - startedAt
      }
      lastTickAt = now
      if (running) {
        channel.port2.postMessage(0)
      }
    }
    channel.port2.postMessage(0)
    return {
      // Idempotent: callers stop the probe in a finally as well as on the happy
      // path, and a second stop must not report a longer window than the first.
      stop: () => {
        if (stopped) {
          return stopped
        }
        running = false
        stopped = {
          maxBlockMs,
          maxBlockAtMs,
          sampleCount,
          windowMs: performance.now() - startedAt
        }
        channel.port1.close()
        channel.port2.close()
        return stopped
      }
    }
  })
}

/**
 * Closes a window, records it, and refuses to return one that measured nothing.
 *
 * The liveness check is the point: a probe that never ticked reports
 * `maxBlockMs: 0`, which reads as a perfectly responsive renderer — that is how
 * a lag budget goes green having observed no renderer at all. A real freeze is
 * the other shape, few samples but `maxBlockMs` covering most of the window, so
 * that still reports rather than throwing.
 *
 * It logs on green as well as red because every timing budget in this repo was
 * unreadable until someone re-ran it by hand to recover the value.
 * See docs/reference/timing-budget-assertions.md.
 */
export async function readRendererBlockWindow(
  probe: RendererMainThreadBlockProbe,
  label: string
): Promise<RendererBlockWindow> {
  const window = await probe.evaluate((handle) => handle.stop())
  if (window.sampleCount < MIN_MEASURED_SAMPLES) {
    throw new Error(
      `${label} main-thread block probe did not tick ` +
        `(${window.sampleCount} samples over ${window.windowMs.toFixed(0)}ms, ` +
        `maxBlock=${window.maxBlockMs.toFixed(1)}ms) — the window measured nothing`
    )
  }
  console.log('[block-probe]', formatBlockWindow(window, label))
  return window
}

export function formatBlockWindow(window: RendererBlockWindow, label: string): string {
  return (
    `${label} block=${window.maxBlockMs.toFixed(1)}ms at +${window.maxBlockAtMs.toFixed(0)}ms ` +
    `over ${window.windowMs.toFixed(0)}ms (${window.sampleCount} samples)`
  )
}
