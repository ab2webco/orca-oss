/**
 * TEMPORARY diagnostic for ORCA-197: a `locator.click()` that hangs in
 * "waiting for element to be visible, enabled and stable" says nothing about
 * WHICH of the three gates never opened. Playwright's stability gate samples
 * the bounding box across consecutive animation frames, so a renderer whose
 * `requestAnimationFrame` never fires stalls forever on a page that screenshots
 * perfectly. This reports the frame cadence, the sampled boxes and the
 * element's own disabled/visibility state so the failure can be classified.
 *
 * Delete once ORCA-197 has the answer.
 */

import type { Locator, Page } from '@stablyai/playwright-test'

const SAMPLE_WINDOW_MS = 1_000
const SAMPLE_ABORT_MS = 3_000

async function countAnimationFrames(page: Page): Promise<number> {
  return page.evaluate(
    ({ windowMs, abortMs }) =>
      new Promise<number>((resolve) => {
        let frames = 0
        const start = performance.now()
        // Why: a starved rAF never calls back, so the timeout is the signal.
        const abort = setTimeout(() => resolve(frames), abortMs)
        const tick = (): void => {
          frames += 1
          if (performance.now() - start >= windowMs) {
            clearTimeout(abort)
            resolve(frames)
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { windowMs: SAMPLE_WINDOW_MS, abortMs: SAMPLE_ABORT_MS }
  )
}

export async function describeClickBlocker(locator: Locator, page: Page): Promise<string> {
  const frames = await countAnimationFrames(page).catch(() => -1)
  const visibilityState = await page.evaluate(() => document.visibilityState).catch(() => 'unknown')
  const element = await locator
    .evaluate((el) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return {
        disabled: (el as HTMLButtonElement).disabled === true,
        ariaDisabled: el.getAttribute('aria-disabled'),
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        display: style.display,
        opacity: style.opacity,
        rect: `${rect.x},${rect.y},${rect.width},${rect.height}`
      }
    })
    .catch((error: unknown) => ({ error: String(error) }))
  const boxes = await locator
    .evaluate(
      (el, abortMs) =>
        new Promise<string[]>((resolve) => {
          const samples: string[] = []
          const abort = setTimeout(() => resolve(samples), abortMs)
          const tick = (): void => {
            const rect = el.getBoundingClientRect()
            samples.push(`${rect.x},${rect.y},${rect.width},${rect.height}`)
            if (samples.length >= 6) {
              clearTimeout(abort)
              resolve(samples)
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
      SAMPLE_ABORT_MS
    )
    .catch(() => [])
  return [
    `click blocker report:`,
    `  animation frames in ${SAMPLE_WINDOW_MS}ms: ${frames} (0 ⇒ rAF starved: Playwright's stability gate can never close)`,
    `  document.visibilityState: ${visibilityState}`,
    `  element: ${JSON.stringify(element)}`,
    `  bounding boxes across frames: ${JSON.stringify(boxes)}`
  ].join('\n')
}

/** Click, and on failure attach the blocker report to the thrown error. */
export async function clickWithBlockerReport(
  locator: Locator,
  page: Page,
  timeoutMs = 15_000
): Promise<void> {
  try {
    await locator.click({ timeout: timeoutMs })
  } catch (error) {
    const report = await describeClickBlocker(locator, page).catch(
      (reportError: unknown) => `click blocker report unavailable: ${String(reportError)}`
    )
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${report}`)
  }
}
