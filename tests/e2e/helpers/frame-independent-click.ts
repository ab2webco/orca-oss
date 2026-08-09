/**
 * Clicking a control whose Playwright stability gate can never close.
 *
 * `locator.click()` waits for the element to be visible, enabled AND stable,
 * and the stability check is a pure `requestAnimationFrame` loop with no
 * timeout fallback (playwright-core injectedScriptSource). The E2E window is
 * never shown, so Chromium produces no compositor frames for it and rAF never
 * fires — the click then burns its full timeout on a control that screenshots
 * perfectly. Measured on a settings pane in run 31328287420:
 *
 *   animation frames in 1000ms: 0
 *   element: {"disabled":false,"pointerEvents":"auto","opacity":"1", ...}
 *   bounding boxes across frames: []
 *
 * So assert the gates that carry meaning — visible and enabled — in the test,
 * and drop only the frame-dependent one. A control covered by an overlay still
 * fails, because the forced click lands on the overlay and whatever the click
 * was supposed to open never appears.
 */

import { expect, type Locator, type Page } from '@stablyai/playwright-test'

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

/** Frame cadence and the element's own state — why a click could not proceed. */
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
  return [
    `click blocker report:`,
    `  animation frames in ${SAMPLE_WINDOW_MS}ms: ${frames} (0 ⇒ rAF starved: the stability gate can never close)`,
    `  document.visibilityState: ${visibilityState}`,
    `  element: ${JSON.stringify(element)}`
  ].join('\n')
}

/**
 * Assert the meaningful actionability gates, then click past the frame-bound
 * one. Use for controls on a static pane, where nothing invalidates the
 * compositor and rAF therefore never runs.
 */
export async function clickWithoutFrameDependency(
  locator: Locator,
  page: Page,
  timeoutMs = 15_000
): Promise<void> {
  await expect(locator).toBeVisible({ timeout: timeoutMs })
  await expect(locator).toBeEnabled({ timeout: timeoutMs })
  try {
    await locator.click({ force: true, timeout: timeoutMs })
  } catch (error) {
    const report = await describeClickBlocker(locator, page).catch(
      (reportError: unknown) => `click blocker report unavailable: ${String(reportError)}`
    )
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${report}`)
  }
}
