import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const HINT = {
  en: 'Workspace board moved to the bottom bar',
  es: 'El tablero de espacios de trabajo se movió a la barra inferior'
} as const

// Why: the hint closes itself 12 s after it opens, and on CI each screenshot takes up to 3 s, so
// one window could not hold every width. Remounting the toolbar with the seen flag cleared opens it again.
async function reopenHint(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem('orca.workspaceBoardMovedHintSeen.v1')
    window.__store!.getState().setSidebarOpen(false)
  })
  await expect(page.locator('[data-workspace-board-trigger]')).toHaveCount(0)
  await page.evaluate(() => window.__store!.getState().setSidebarOpen(true))
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
}

// ORCA-1098: at 320 in Spanish the first-run board hint ran past the right edge and was cut.
test('the workspace board hint wraps inside a phone-wide window, in English and Spanish', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await expect(orcaPage.getByText(HINT.en)).toBeVisible({ timeout: 30_000 })
  for (const language of ['es', 'en'] as const) {
    await orcaPage.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    const hint = orcaPage
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: HINT[language] })
    for (const width of [320, 390]) {
      await orcaPage.setViewportSize({ width, height: 800 })
      await reopenHint(orcaPage)
      await expect(hint).toBeVisible()
      await expect
        .poll(
          async () => {
            const box = await hint.boundingBox()
            return box ? box.x >= 0 && box.x + box.width <= width : false
          },
          { message: `the hint runs past the window at ${width}px in ${language}` }
        )
        .toBe(true)
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`board-hint-${language}-${width}-${theme}.png`)
        })
      }
    }
  }
})
