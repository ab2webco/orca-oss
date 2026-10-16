import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import type { GlobalSettings } from '../../src/shared/global-settings-types'

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

async function savedGameSettings(
  page: Page
): Promise<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>> {
  return page.evaluate(async () => {
    const settings = await window.api.settings.get()
    return {
      orchestratorGame: settings.orchestratorGame,
      orchestratorGameProjects: settings.orchestratorGameProjects
    }
  })
}

async function shootAll(
  app: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  name: string,
  section: ReturnType<Page['locator']>
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(app, page, width)
      await section.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`) })
    }
  }
}

test('global and per-project Agent Teams game settings persist and render at every width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  const globalSection = orcaPage.getByRole('radiogroup', { name: 'Game mode' }).first()
  await expect(globalSection).toBeVisible({ timeout: 15_000 })

  await globalSection.getByRole('radio', { name: 'Zen' }).click()
  await orcaPage.getByRole('switch', { name: 'Rewards' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGame)
    .toEqual({ mode: 'zen', rewards: false })

  await shootAll(electronApp, orcaPage, testInfo, 'global', globalSection)

  await setWindowWidth(electronApp, orcaPage, 1440)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the harness seeds one repo').not.toBeNull()
  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)

  const projectMode = orcaPage.getByRole('radiogroup', { name: 'Game mode' }).first()
  await expect(projectMode).toBeVisible({ timeout: 15_000 })
  await expect(orcaPage.getByText('Zen · global setting')).toBeVisible()

  await projectMode.getByRole('radio', { name: 'Off' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({ [repoId as string]: { mode: 'off' } })
  await expect(orcaPage.getByText('Off · this machine')).toBeVisible()

  await shootAll(electronApp, orcaPage, testInfo, 'project', projectMode)
})
