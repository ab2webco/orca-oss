import type { Page } from '@stablyai/playwright-test'

/**
 * Peak event-loop lag over an idle window of `windowMs`, sampled in the renderer.
 *
 * Why one shared copy: this is the instrument the timing-budget assertions are judged
 * against. Two copies drift apart silently — both specs stay green while each measures
 * its own definition of "floor".
 *
 * Why the caller passes the length: those windows end when the panel renders, so the
 * machine decides how long they are. Sampling the floor for exactly that many ms, same
 * page and back to back, is what makes the two comparable; a fixed-length floor would
 * judge unequal windows against each other.
 */
export async function measureIdleFloorMs(orcaPage: Page, windowMs: number): Promise<number> {
  return orcaPage.evaluate(async (durationMs: number) => {
    const intervalMs = 50
    let last = performance.now()
    let maxLagMs = 0
    const timer = window.setInterval(() => {
      const now = performance.now()
      maxLagMs = Math.max(maxLagMs, Math.max(0, now - last - intervalMs))
      last = now
    }, intervalMs)
    await new Promise((resolve) => window.setTimeout(resolve, durationMs))
    window.clearInterval(timer)
    return maxLagMs
  }, windowMs)
}
