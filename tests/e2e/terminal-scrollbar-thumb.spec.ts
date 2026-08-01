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
  scrollbarZIndex: string
  trackTop: number
  trackHeight: number
  sliderTop: number
  sliderLeft: number
  sliderHeight: number
  sliderWidth: number
  sliderBackground: string
  /** z-index of xterm's overview-ruler canvas, which shares the scrollbar gutter. */
  overviewRulerZIndex: string | null
  /** buffer.active.viewportY of the active pane — the only proof a drag actually scrolled. */
  viewportY: number
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
    const ruler = document.querySelector('.xterm .xterm-decoration-overview-ruler')
    const scrollbarRect = scrollbar.getBoundingClientRect()
    const sliderRect = slider.getBoundingClientRect()
    let viewportY = -1
    for (const manager of window.__paneManagers?.values() ?? []) {
      const terminal = (
        manager.getActivePane?.() as unknown as
          | { terminal?: { buffer: { active: { viewportY: number } } } }
          | null
          | undefined
      )?.terminal
      if (terminal) {
        viewportY = terminal.buffer.active.viewportY
      }
    }
    return {
      scrollbarClassName: scrollbar.className,
      scrollbarOpacity: scrollbarStyle.opacity,
      scrollbarPointerEvents: scrollbarStyle.pointerEvents,
      scrollbarZIndex: scrollbarStyle.zIndex,
      trackTop: scrollbarRect.top,
      trackHeight: scrollbarRect.height,
      sliderTop: sliderRect.top,
      sliderLeft: sliderRect.left,
      sliderHeight: sliderRect.height,
      sliderWidth: sliderRect.width,
      sliderBackground: sliderStyle.backgroundColor,
      overviewRulerZIndex: ruler ? getComputedStyle(ruler).zIndex : null,
      viewportY
    }
  })
}

/** Reaches the state the ORCA-133 rescue exists for: buffer scrollable, pointer parked
 *  outside the terminal, xterm's 500ms auto-hide already fired. */
async function settleIntoPersistentScrollbar(page: Page): Promise<ScrollbarProbe> {
  await page.mouse.move(0, 0)
  await expect
    .poll(
      async () => {
        const sample = await probeVerticalScrollbar(page)
        return sample?.scrollbarClassName.includes('xterm-fade') ?? false
      },
      {
        timeout: SCROLLBAR_AUTO_HIDE_SETTLE_MS,
        message: 'scrollbar never reached the hidden state'
      }
    )
    .toBe(true)
  const probe = await probeVerticalScrollbar(page)
  expect(probe).not.toBeNull()
  return probe!
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

  test('scrolls the viewport when the persistent thumb is dragged', async ({ orcaPage: page }) => {
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await waitForActiveTerminalManager(page)
    const ptyId = await waitForActivePanePtyId(page)

    await execInTerminal(page, ptyId, 'seq 1 500')
    await waitForTerminalOutput(page, '500', 30_000)
    await waitForScrollableBuffer(page)
    const settled = await settleIntoPersistentScrollbar(page)
    expect(settled.viewportY, 'buffer is not scrolled to the bottom').toBeGreaterThan(0)

    // Grab the thumb cold — the pointer enters the gutter from outside, which is the only
    // way a user reaches a bar that xterm has already auto-hidden.
    const x = settled.sliderLeft + settled.sliderWidth / 2
    await page.mouse.move(x, settled.sliderTop + settled.sliderHeight / 2)
    await page.mouse.down()
    await page.mouse.move(x, settled.trackTop + 2, { steps: 12 })

    // viewportY, not `.xterm-active`: the class flip only proves pointerdown landed. If the
    // pointer-capture move loop never runs, the class assertion still passes and nothing scrolls.
    await expect
      .poll(async () => (await probeVerticalScrollbar(page))?.viewportY ?? -1, {
        timeout: 5_000,
        message: 'dragging the thumb did not scroll the viewport'
      })
      .toBe(0)
    await page.mouse.up()
  })

  test('stacks the persistent bar above the overview ruler sharing its gutter', async ({
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
    const settled = await settleIntoPersistentScrollbar(page)

    // scrollbar.width also enables xterm's overview ruler, a canvas pinned to the same
    // gutter at z-index 8 (TerminalSearch paints match marks on it). xterm's own
    // `.xterm-visible` rule lifts the bar to 11 for exactly this reason; a bar kept
    // painted at `z-index: auto` renders *under* the ruler.
    expect(settled.overviewRulerZIndex, 'overview ruler canvas missing').not.toBeNull()
    expect(Number.parseInt(settled.scrollbarZIndex, 10)).toBeGreaterThanOrEqual(
      Number.parseInt(settled.overviewRulerZIndex!, 10)
    )
  })

  test('stops painting the bar once a relay snapshot leaves nothing to scroll', async ({
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
    await settleIntoPersistentScrollbar(page)

    // The exact payload remote-runtime-terminal-multiplexer.ts wraps every relay snapshot in:
    // ED 3 drops the scrollback, so an SSH/relay pane repaints into a buffer that no longer
    // overflows. xterm's own hide is a no-op here (its controller skips the class write when
    // the bar is already hidden), so the bar keeps whatever class it timed out with.
    await page.evaluate(() => {
      for (const manager of window.__paneManagers?.values() ?? []) {
        const terminal = (
          manager.getActivePane?.() as unknown as
            | { terminal?: { write(data: string): void } }
            | null
            | undefined
        )?.terminal
        terminal?.write('\x1b[2J\x1b[3J\x1b[Hrelay snapshot\r\n')
      }
    })
    await page.mouse.move(0, 0)

    await expect
      .poll(
        async () => {
          const sample = await probeVerticalScrollbar(page)
          if (!sample) {
            return 'no-scrollbar'
          }
          if (sample.sliderHeight < sample.trackHeight) {
            return `still-scrollable (slider ${sample.sliderHeight}/${sample.trackHeight})`
          }
          return Number.parseFloat(sample.scrollbarOpacity) === 0
            ? 'hidden'
            : `full-track strip painted (opacity ${sample.scrollbarOpacity})`
        },
        { timeout: SCROLLBAR_AUTO_HIDE_SETTLE_MS }
      )
      .toBe('hidden')

    // A bar with nothing to scroll must also stop swallowing clicks: xterm's drag handler
    // early-returns when the scrollbar is not needed, so a grabbable one is a dead target.
    const probe = await probeVerticalScrollbar(page)
    expect(probe!.scrollbarPointerEvents).toBe('none')
  })
})
