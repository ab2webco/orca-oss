import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

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

// Why: Orca Lab ships English and Spanish only (ORCA-596); the picker must offer nothing else.
test('the Settings language picker offers only System, English and Español', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'appearance', repoId: null })
    state.openSettingsPage()
  })
  const trigger = orcaPage.locator('[data-slot="select-trigger"][aria-label="Language"]')
  await expect(trigger).toBeVisible({ timeout: 15_000 })

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await trigger.scrollIntoViewIfNeeded()
      await trigger.click()
      const options = orcaPage.getByRole('option')
      await expect(options).toHaveText(['System', 'English', 'Español'])
      // Why: the menu fades and zooms in; a frame taken mid-animation shows it half transparent.
      await orcaPage.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running')
      )
      await expect(orcaPage.locator('[data-slot="select-content"]')).toBeInViewport()
      await orcaPage.screenshot({ path: testInfo.outputPath(`language-${theme}-${width}.png`) })
      await orcaPage.keyboard.press('Escape')
      await expect(options).toHaveCount(0)
    }
  }
})
