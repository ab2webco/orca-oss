import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

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

async function setLanguage(page: Page, uiLanguage: 'en' | 'es'): Promise<void> {
  await page.evaluate(
    (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
    uiLanguage
  )
}

const COPY = {
  en: {
    title: 'Team',
    unavailable: 'Team data is not available',
    gear: 'Panel settings'
  },
  es: {
    title: 'Equipo',
    unavailable: 'Los datos del equipo no están disponibles',
    gear: 'Ajustes del panel'
  }
} as const

// The Team tab is a right sidebar tab like Explorer (ORCA-1050). Until a host publishes the team
// model it says so, and never draws rows it does not have.
test('the Team tab opens in the right sidebar and says so when the host has no team data', async ({
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
    await expect(panel.getByText(copy.unavailable)).toBeVisible()
    await expect(panel.getByRole('tablist')).toHaveCount(0)

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
