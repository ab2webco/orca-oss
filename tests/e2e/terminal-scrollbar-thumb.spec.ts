import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

// Budget for xterm's 500ms hide timer plus the 800ms fade transition, with room for a late
// PTY write to re-reveal the bar and restart the timer once or twice.
const SCROLLBAR_AUTO_HIDE_SETTLE_MS = 10_000

type ScrollbarProbe = {
  /** Class list of the vertical scrollbar; xterm-fade marks a needed bar that timed out. */
  scrollbarClassName: string
  scrollbarOpacity: string
  scrollbarPointerEvents: string
  trackHeight: number
  sliderHeight: number
  sliderWidth: number
  sliderBackground: string
}

async function probeVerticalScrollbar(page: Page): Promise<ScrollbarProbe | null> {
  return page.evaluate(() => {
    const scrollbar = document.querySelector(
      '.xterm .xterm-scrollable-element > .xterm-scrollbar.xterm-vertical'
    )
    const slider = scrollbar?.querySelector(':scope > .xterm-slider')
    if (!scrollbar || !slider) {
      return null
    }
    const scrollbarStyle = getComputedStyle(scrollbar)
    const sliderStyle = getComputedStyle(slider)
    return {
      scrollbarClassName: scrollbar.className,
      scrollbarOpacity: scrollbarStyle.opacity,
      scrollbarPointerEvents: scrollbarStyle.pointerEvents,
      trackHeight: scrollbar.getBoundingClientRect().height,
      sliderHeight: slider.getBoundingClientRect().height,
      sliderWidth: slider.getBoundingClientRect().width,
      sliderBackground: sliderStyle.backgroundColor
    }
  })
}

/** Polls until the buffer genuinely overflows, so the assertions never run against a
 *  scrollbar xterm has correctly decided is unnecessary (slider spanning the whole track). */
async function waitForScrollableBuffer(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const probe = await probeVerticalScrollbar(page)
        return Boolean(probe && probe.sliderHeight > 0 && probe.sliderHeight < probe.trackHeight)
      },
      { timeout: 30_000, message: 'terminal buffer never became scrollable' }
    )
    .toBe(true)
}

test.describe('terminal scrollbar thumb', () => {
  test('stays grabbable after the pointer leaves and the auto-hide timer fires', async ({
    orcaPage: page
  }) => {
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await waitForActiveTerminalManager(page)
    const ptyId = await waitForActivePanePtyId(page)

    await execInTerminal(page, ptyId, 'seq 1 500')
    await waitForTerminalOutput(page, '500', 30_000)
    await waitForScrollableBuffer(page)

    // Park the pointer outside the terminal so _mouseIsOver is false and the hide timer runs.
    await page.mouse.move(0, 0)

    // Premise and value are read from ONE probe: sampling them in separate round trips lets the
    // bar change state in between, which is how this passed locally and failed on CI. xterm-fade
    // is the premise — without it the bar is hidden because it is not needed, not because of the
    // auto-hide, and the visibility check would pass for the wrong reason.
    await expect
      .poll(
        async () => {
          const sample = await probeVerticalScrollbar(page)
          if (!sample) {
            return 'no-scrollbar'
          }
          if (!sample.scrollbarClassName.includes('xterm-fade')) {
            return `not-auto-hidden-yet (${sample.scrollbarClassName})`
          }
          // pointer-events is part of the predicate, not a later assert: it flips with the class
          // and never transitions, so it rejects a bar caught mid fade-out whose opacity is still
          // a fraction on its way to 0 — which would otherwise read as "visible".
          if (sample.scrollbarPointerEvents === 'none') {
            return 'not grabbable (pointer-events: none)'
          }
          return Number.parseFloat(sample.scrollbarOpacity) > 0
            ? 'visible'
            : `hidden (opacity ${sample.scrollbarOpacity})`
        },
        { timeout: SCROLLBAR_AUTO_HIDE_SETTLE_MS }
      )
      .toBe('visible')

    const probe = await probeVerticalScrollbar(page)
    expect(probe).not.toBeNull()
    expect(Number.parseFloat(probe!.scrollbarOpacity)).toBeGreaterThan(0)
    expect(probe!.scrollbarPointerEvents).not.toBe('none')
    expect(probe!.sliderWidth).toBeGreaterThan(0)
    expect(probe!.sliderHeight).toBeGreaterThan(0)
    expect(probe!.sliderHeight).toBeLessThan(probe!.trackHeight)
  })

  test('paints a slider distinguishable from the background in dark and light themes', async ({
    orcaPage: page
  }) => {
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await waitForActiveTerminalManager(page)
    const ptyId = await waitForActivePanePtyId(page)

    await execInTerminal(page, ptyId, 'seq 1 500')
    await waitForTerminalOutput(page, '500', 30_000)
    await waitForScrollableBuffer(page)

    for (const mode of ['dark', 'light'] as const) {
      await page.evaluate(async (themeMode) => {
        await window.__store?.getState().updateSettings({
          theme: themeMode,
          terminalUseSeparateLightTheme: themeMode === 'light'
        })
      }, mode)
      await page.waitForTimeout(1000)
      await waitForScrollableBuffer(page)

      const probe = await probeVerticalScrollbar(page)
      expect(probe, `${mode}: vertical scrollbar missing`).not.toBeNull()
      const alpha = Number.parseFloat(
        probe!.sliderBackground.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/)?.[1] ?? '1'
      )
      expect(alpha, `${mode}: slider alpha too low to see over a 7px bar`).toBeGreaterThanOrEqual(
        0.5
      )
      expect(probe!.sliderWidth, `${mode}: slider has no width`).toBeGreaterThan(0)
    }
  })
})
