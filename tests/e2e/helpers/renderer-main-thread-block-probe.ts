import type { JSHandle, Page } from '@stablyai/playwright-test'

/** One measurement window of the renderer's main thread. */
export type RendererBlockWindow = {
  /** Longest interval the main thread went without servicing a posted task. */
  maxBlockMs: number
  /** Offset of that block from the window start, so it can be located in the run. */
  maxBlockAtMs: number
  /** Tasks the sampler serviced. Near-zero means the instrument, not the renderer, was dead. */
  sampleCount: number
  /** `performance.now()` at window start, so another instrument's entries can be lined up with it. */
  startedAtMs: number
  windowMs: number
}

export type RendererMainThreadBlockProbe = JSHandle<{ stop: () => RendererBlockWindow }>

/** A window with fewer ticks than this measured nothing; see readRendererBlockWindow. */
const MIN_MEASURED_SAMPLES = 2

/**
 * Longest stretch the renderer's main thread went without servicing a task.
 *
 * MessagePort tasks are ordinary macrotasks: not tied to a compositor frame
 * (the E2E window is never shown, so rAF fires at ~1Hz or not at all) and not
 * subject to timer clamping. Keeping the longest gap, rather than sampling,
 * catches a block wherever in the window it lands.
 *
 * Calibrated in renderer-main-thread-block-probe-calibration.spec.ts.
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
      startedAtMs: number
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
          startedAtMs: startedAt,
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
 * A probe that never ticked reports `maxBlockMs: 0`, indistinguishable from a
 * responsive renderer — that is how a lag budget goes green having observed
 * nothing. A real freeze is the other shape (few samples, `maxBlockMs` covering
 * most of the window), so it still reports rather than throwing.
 *
 * Logs on green too: see docs/reference/timing-budget-assertions.md.
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
