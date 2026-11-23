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
  await writeSettings(page, { uiLanguage })
}

const COPY = {
  en: {
    title: 'Your work',
    empty: 'No agents running',
    firstRun: 'Start a team',
    gear: 'Project settings'
  },
  es: {
    title: 'Tu trabajo',
    empty: 'No hay agentes en marcha',
    firstRun: 'Arma un equipo',
    gear: 'Ajustes del proyecto'
  }
} as const

// The Team tab is a right sidebar tab like Explorer (ORCA-1050). With no game team it is the user's
// own work (ORCA-1074), and with no agent running it says so instead of drawing rows. With no team it
// also says how to start one (ORCA-1304).
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
  // Why before any setViewportSize: the panel's width is capped by the window, which the
  // viewport emulation narrows for the rest of the run.
  const sidebarWidth = await orcaPage.evaluate(() => window.__store!.getState().rightSidebarWidth)
  for (const language of ['en', 'es'] as const) {
    await setLanguage(orcaPage, language)
    const copy = COPY[language]
    await expect(panel.getByRole('heading', { name: copy.title })).toBeVisible()
    await expect(panel.getByText(copy.empty)).toBeVisible()
    // ORCA-1304: with no team, the panel says how to start one.
    const firstRun = panel.locator('[data-team-first-run]')
    await expect(firstRun).toContainText(copy.firstRun)
    await expect(firstRun).toContainText('/orca-game:setup')
    // Why the side panel's widths: the hint's room is the panel's (219 clamps to 220).
    for (const sidebar of [220, 320, 350, 640]) {
      await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), sidebar)
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`first-run-${language}-${sidebar}-${theme}.png`)
        })
      }
    }
  }
  await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), sidebarWidth)

  for (const language of ['en', 'es'] as const) {
    await setLanguage(orcaPage, language)
    const copy = COPY[language]
    await expect(panel.getByRole('heading', { name: copy.title })).toBeVisible()
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

  // ORCA-1328: with no team the gear opens the active worktree's project, not the global section.
  const repoId = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const id = state.activeWorktreeId
    return Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === id)?.repoId
  })
  expect(repoId).toBeTruthy()
  await setLanguage(orcaPage, 'en')
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await panel.getByRole('button', { name: COPY.en.gear }).click()
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        return {
          view: state.activeView,
          pane: state.settingsNavigationTarget?.pane ?? null,
          repoId: state.settingsNavigationTarget?.repoId ?? null
        }
      })
    )
    .toEqual({ view: 'settings', pane: 'repo', repoId })
  await expect(orcaPage.locator(`[id="repo-${repoId}-game"]`)).toBeInViewport({ timeout: 15_000 })
})
