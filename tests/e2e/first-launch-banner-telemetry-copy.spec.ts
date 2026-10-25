/**
 * Invariant: the first-launch banner states what the running build does. A build that cannot
 * transmit says it sends no telemetry, and a transmitting build keeps its usage-counts notice
 * (ORCA-789).
 * Needs E2E: the copy is chosen from the real main-process gate over IPC, and the fixed banner
 * must stay readable and in-bounds from 1440 down to 320px in both themes.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320]
const NO_TRANSMIT_TITLE = 'This Orca Lab build sends no telemetry'
const NO_TRANSMIT_BODY = 'do not send usage counts or any other telemetry'
const TRANSMIT_BODY = 'Anonymous counts of which features you use'

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

/** The E2E profile is a new user who already decided; the banner is for an undecided existing user. */
async function seedUndecidedExistingUser(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    const settings = store.getState().settings!
    store.setState({
      settings: {
        ...settings,
        telemetry: { ...settings.telemetry!, existedBeforeTelemetryRelease: true, optedIn: null }
      }
    })
  })
}

function banner(page: Page) {
  return page.getByRole('region', { name: 'Telemetry notice' })
}

test('states that a Lab build sends no telemetry at every width and theme', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  await setTheme(orcaPage, 'light')
  await seedUndecidedExistingUser(orcaPage)

  // The E2E build is not an official release build, so the real gate reports no transmission.
  await expect(banner(orcaPage)).toBeVisible()
  await expect(banner(orcaPage).getByText(NO_TRANSMIT_TITLE)).toBeVisible()
  await expect(banner(orcaPage).getByText(NO_TRANSMIT_BODY)).toBeVisible()
  await expect(banner(orcaPage).getByText(TRANSMIT_BODY)).toHaveCount(0)

  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(orcaPage, theme)
      await expect(banner(orcaPage)).toBeInViewport({ ratio: 1 })
      for (const name of ['Opt out', 'Got it', 'Privacy policy']) {
        await expect(banner(orcaPage).getByRole('button', { name })).toBeInViewport({ ratio: 1 })
      }
      const overflowsSideways = await orcaPage.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      )
      expect(overflowsSideways, `horizontal page scroll at ${width}px ${theme}`).toBe(false)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`first-launch-banner-${width}-${theme}.png`)
      })
    }
  }
})

test('keeps the usage-counts notice when the gate reports a transmitting build', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('telemetry:getTransmitsInBuild')
    ipcMain.handle('telemetry:getTransmitsInBuild', () => true)
  })
  // The surface reads the gate once on mount, so remount the renderer behind the overridden handler.
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  await setTheme(orcaPage, 'light')
  await seedUndecidedExistingUser(orcaPage)

  await expect(banner(orcaPage).getByText(TRANSMIT_BODY)).toBeVisible()
  await expect(banner(orcaPage).getByText('Help us decide what to build next')).toBeVisible()
  await expect(banner(orcaPage).getByText(NO_TRANSMIT_TITLE)).toHaveCount(0)
  await orcaPage.screenshot({
    path: testInfo.outputPath('first-launch-banner-transmitting-1440-light.png')
  })
})
