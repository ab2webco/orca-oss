import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './settings-window'
import { clickTerminalText, screenRows, terminalPointOf } from './orchestrator-game-band'

const HOLD_MS = 1_500
// Why: Claude Code's terminal loses a click that lands while a pane redraws (keys are not lost),
// so each chip is clicked once, after the redraw that drew it.
const REDRAW_MS = 1_000

export const screenText = async (page: Page) => (await screenRows(page)).join('\n')

export async function clickOnceRedrawn(page: Page, chip: string): Promise<void> {
  await page.waitForTimeout(REDRAW_MS)
  await clickTerminalText(page, chip)
}

/** Wheels the Panel down until `heading` is on screen, so a short docked pane still shows it. */
async function scrollPanelTo(page: Page, heading: string): Promise<void> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel menu is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 20 && !(await screenText(page)).includes(heading); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
  }
  expect(await screenText(page)).toContain(heading)
}

// Why: startup UI hydration can reopen the right sidebar after the band starts, squeezing the Panel.
async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
  await expect
    .poll(async () => page.evaluate(() => window.__store!.getState().rightSidebarOpen))
    .toBe(false)
}

/**
 * One screenshot per theme and width, `<name>-<theme>-<width>.png`, plus a `-scrolled` one where
 * the docked Panel is too short to show `heading` unscrolled.
 */
export async function captureEveryWidth(
  electronApp: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  name: string,
  heading: string
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, page, width)
      await closeSidebars(page)
      await page.waitForTimeout(HOLD_MS)
      const shot = `${name}-${theme}-${width}`
      await page.screenshot({ path: testInfo.outputPath(`${shot}.png`), animations: 'disabled' })
      if (!(await screenText(page)).includes(heading)) {
        await scrollPanelTo(page, heading)
        await page.waitForTimeout(HOLD_MS)
        await page.screenshot({
          path: testInfo.outputPath(`${shot}-scrolled.png`),
          animations: 'disabled'
        })
        await page.mouse.wheel(0, -2_400)
      }
    }
  }
}
