import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { ORCA_CHANGELOG_URL, ORCA_DOCS_INDEX_URL } from '../../src/shared/orca-docs-urls'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

type OpenedUrlsGlobal = { __orcaOpenedUrls?: string[] }

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

/** A capture taken mid-transition shows a half-faded surface, so wait for the surface's own animations. */
async function waitForSurfaceToSettle(surface: Locator): Promise<void> {
  await expect
    .poll(() =>
      surface.evaluate((element) =>
        element.getAnimations().every((animation) => animation.playState !== 'running')
      )
    )
    .toBe(true)
}

async function recordOpenedUrls(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const opened: string[] = []
    ;(globalThis as OpenedUrlsGlobal).__orcaOpenedUrls = opened
    ipcMain.removeHandler('shell:openUrl')
    ipcMain.handle('shell:openUrl', (_event, url: string) => {
      opened.push(url)
    })
  })
}

async function readOpenedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as OpenedUrlsGlobal).__orcaOpenedUrls ?? [])
}

async function openFeatureTourFromMenu(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const featureTourItem = Menu.getApplicationMenu()
      ?.items.find((item) => item.label === 'Help')
      ?.submenu?.items.find((item) => item.label === 'Explore Orca Lab')
    if (!featureTourItem) {
      throw new Error('Explore Orca Lab menu item was not registered')
    }
    const window = BrowserWindow.getAllWindows()[0]
    featureTourItem.click(featureTourItem, window, {
      triggeredByAccelerator: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false
    } as Electron.KeyboardEvent)
  })
}

test.describe('User docs links from the Help menu', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
  })

  test('Docs and Changelog open the docs and releases of this repository', async ({
    electronApp,
    orcaPage
  }) => {
    await recordOpenedUrls(electronApp)

    await orcaPage.getByRole('button', { name: 'Help', exact: true }).click()
    await orcaPage.getByRole('menuitem', { name: 'Docs', exact: true }).click()
    await expect.poll(() => readOpenedUrls(electronApp)).toEqual([ORCA_DOCS_INDEX_URL])
    await expect(orcaPage.getByRole('menuitem', { name: 'Docs', exact: true })).toHaveCount(0)

    await orcaPage.getByRole('button', { name: 'Help', exact: true }).click()
    await orcaPage.getByRole('menuitem', { name: 'Changelog', exact: true }).click()
    await expect
      .poll(() => readOpenedUrls(electronApp))
      .toEqual([ORCA_DOCS_INDEX_URL, ORCA_CHANGELOG_URL])
  })

  test('captures the Help menu and the feature tour at every width and theme', async ({
    electronApp,
    orcaPage
  }, testInfo: TestInfo) => {
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)

        await orcaPage.getByRole('button', { name: 'Help', exact: true }).click()
        const helpMenu = orcaPage.getByRole('menu')
        await expect(helpMenu).toBeVisible()
        await expect(helpMenu.getByRole('menuitem', { name: 'Docs', exact: true })).toBeVisible()
        await waitForSurfaceToSettle(helpMenu)
        await orcaPage.screenshot({ path: testInfo.outputPath(`help-menu-${width}-${theme}.png`) })
        await orcaPage.keyboard.press('Escape')
        await expect(helpMenu).toHaveCount(0)

        await openFeatureTourFromMenu(electronApp)
        const tour = orcaPage.getByRole('dialog', { name: 'Get to know Orca Lab' })
        await expect(tour).toBeVisible({ timeout: 10_000 })
        await waitForSurfaceToSettle(tour)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`feature-tour-${width}-${theme}.png`)
        })
        await orcaPage.keyboard.press('Escape')
        await expect(tour).toHaveCount(0)
      }
    }
  })
})
