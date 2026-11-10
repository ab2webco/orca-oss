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

async function setLanguage(page: Page, uiLanguage: 'en' | 'es'): Promise<void> {
  await page.evaluate(
    (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
    uiLanguage
  )
}

const COPY = {
  en: {
    title: 'Your work',
    empty: 'No agents running',
    gear: 'Panel settings'
  },
  es: {
    title: 'Tu trabajo',
    empty: 'No hay agentes en marcha',
    gear: 'Ajustes del panel'
  }
} as const

// The Team tab is a right sidebar tab like Explorer (ORCA-1050). With no game team it is the user's
// own work (ORCA-1074), and with no agent running it says so instead of drawing rows.
test('the Team tab opens in the right sidebar as Your work when there is no team', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })

  const panel = orcaPage.getByTestId('team-panel')
  for (const language of ['en', 'es'] as const) {
    await setLanguage(orcaPage, language)
    const copy = COPY[language]
    await expect(panel.getByRole('heading', { name: copy.title })).toBeVisible()
    await expect(panel.getByText(copy.empty)).toBeVisible()

    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`team-panel-${language}-${width}-${theme}.png`)
        })
      }
    }
  }

  await setLanguage(orcaPage, 'en')
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await panel.getByRole('button', { name: COPY.en.gear }).click()
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        return {
          view: state.activeView,
          pane: state.settingsNavigationTarget?.pane ?? null
        }
      })
    )
    .toEqual({ view: 'settings', pane: 'agents' })
  await expect(orcaPage.locator('[id="agents-game-panel"]')).toBeInViewport({ timeout: 15_000 })
})
