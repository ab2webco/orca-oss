/**
 * ORCA-1163: the new card style's Card display heads its toggles with Work, Agent and Source,
 * and offers the PR toggle the team row already reads. Captured at every width and theme.
 */
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

test.describe('Card display groups', () => {
  test('heads the toggles with Work, Agent and Source and offers the PR toggle', async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await writeSettings(orcaPage, { experimentalNewWorktreeCardStyle: true })

    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      await orcaPage.evaluate(() => window.__store!.getState().setSidebarOpen(true))
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        // Why wait for zero: a menu still animating out reads as visible for ~100 ms and swallows the click.
        await expect(orcaPage.getByRole('menu')).toHaveCount(0)
        await orcaPage.locator('button[aria-label^="Workspace options"]:visible').first().click()
        const cardDisplay = orcaPage.getByRole('menuitem', { name: /Card display/ })
        await cardDisplay.hover()
        const groups = orcaPage.locator('[data-card-display-group]')
        await expect(groups).toHaveText(['Work', 'Agent', 'Source'])
        await expect(
          orcaPage.getByRole('menuitemcheckbox', { name: 'Pull request and checks' })
        ).toBeVisible()
        const overflow = await orcaPage.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
        expect(overflow, `${width}px ${theme}: the page scrolls sideways`).toBeLessThanOrEqual(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`card-display-${width}-${theme}.png`)
        })
        await orcaPage.keyboard.press('Escape')
        await orcaPage.keyboard.press('Escape')
      }
    }
  })
})
