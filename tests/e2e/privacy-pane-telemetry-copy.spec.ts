/**
 * Invariant: the Privacy pane states what the running build does. A build that cannot transmit
 * says so, and a transmitting build keeps the usage-counts claim (ORCA-785).
 * Needs E2E: the statement is read from the real main-process gate over IPC, and it must stay
 * readable and in-bounds from 1440 down to 320px in both themes.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320]
const NO_TRANSMIT_COPY = 'Orca Lab builds from this repository do not send telemetry'
const TRANSMIT_COPY = 'Orca Lab sends anonymous counts'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
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

async function openPrivacyPane(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'privacy', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.getByText(/Share anonymous usage data/).first()).toBeVisible()
}

test('states that Lab builds send no telemetry, and keeps the link to the doc', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  await setTheme(orcaPage, 'light')
  await openPrivacyPane(orcaPage)

  // The E2E build is not an official release build, so the real gate reports no transmission.
  await expect(orcaPage.getByText(NO_TRANSMIT_COPY)).toBeVisible()
  await expect(orcaPage.getByText(TRANSMIT_COPY)).toHaveCount(0)
  await expect(orcaPage.getByRole('button', { name: 'Privacy policy' })).toBeVisible()

  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(orcaPage, theme)
      const statement = orcaPage.getByText(NO_TRANSMIT_COPY)
      await expect(statement).toBeInViewport({ ratio: 1 })
      const overflowsSideways = await orcaPage.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      )
      expect(overflowsSideways, `horizontal page scroll at ${width}px ${theme}`).toBe(false)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`privacy-pane-${width}-${theme}.png`)
      })
    }
  }
})

test('keeps the usage-counts claim when the gate reports a transmitting build', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('telemetry:getTransmitsInBuild')
    ipcMain.handle('telemetry:getTransmitsInBuild', () => true)
  })
  await setWindowWidth(electronApp, orcaPage, 1440)
  await setTheme(orcaPage, 'light')
  await openPrivacyPane(orcaPage)

  await expect(orcaPage.getByText(TRANSMIT_COPY)).toBeVisible()
  await expect(orcaPage.getByText(NO_TRANSMIT_COPY)).toHaveCount(0)
  await orcaPage.screenshot({
    path: testInfo.outputPath('privacy-pane-transmitting-1440-light.png')
  })
})
