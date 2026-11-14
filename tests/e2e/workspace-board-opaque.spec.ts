import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { getTerminalContent, sendToTerminal, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'

const MARKER = 'BEHIND-THE-BOARD'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function openBoard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Workspace board' }).click()
  const sheet = page.locator('[data-workspace-board-sheet]')
  await expect(sheet).toBeVisible()
  // Why: the reveal is a clip-path animation; capture after it settles.
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((one) => one.finished.catch(() => undefined)))
  )
}

// ORCA-1116 row 25: the board dropped the Sheet blur but kept its 96% dark fill, so terminal text read through it.
test.describe('Workspace board is opaque', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('paints a solid fill over a terminal full of text in dark and light', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    await ensureTerminalVisible(orcaPage)
    const ptyId = await waitForActivePanePtyId(orcaPage)
    await sendToTerminal(
      orcaPage,
      ptyId,
      `for i in $(seq 1 200); do printf '%s %s %s %s %s\\n' ${MARKER} ${MARKER} ${MARKER} ${MARKER} $i; done\r`
    )
    await expect
      .poll(() => getTerminalContent(orcaPage), { timeout: 20_000 })
      .toContain(`${MARKER} 200`)
    await openBoard(orcaPage)

    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      for (const width of [1440, 768, 390, 320]) {
        await setWindowWidth(electronApp, orcaPage, width)
        const sheet = orcaPage.locator('[data-workspace-board-sheet]')
        await expect(sheet).toBeVisible()
        const fill = await sheet.evaluate((element) => {
          const probe = document.createElement('canvas').getContext('2d')!
          probe.fillStyle = getComputedStyle(element).backgroundColor
          probe.fillRect(0, 0, 1, 1)
          return {
            css: getComputedStyle(element).backgroundColor,
            alpha: probe.getImageData(0, 0, 1, 1).data[3]
          }
        })
        expect(fill.alpha, `${theme} ${width}px board fill ${fill.css}`).toBe(255)
        await orcaPage.screenshot({ path: testInfo.outputPath(`board-${theme}-${width}.png`) })
      }
    }
  })
})
