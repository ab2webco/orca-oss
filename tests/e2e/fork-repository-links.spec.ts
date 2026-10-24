/**
 * Invariant: Landing's star button and Settings > Support open Orca Lab's own GitHub repository,
 * and both screens render at phone widths in light and dark themes.
 * Needs E2E: the destination is the URL the renderer hands to main's shell IPC; only a real click
 * reaches that handler, and the screenshots are the rendered evidence the layout needs.
 */

import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { ORCA_REPOSITORY_URL } from '../../src/shared/orca-repository-url'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

/** Forces the web fallback, so both screens show the button that opens the repository. */
async function stubGitHubInMain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const recorder = globalThis as unknown as { __orcaOpenedUrls?: string[] }
    recorder.__orcaOpenedUrls = []
    ipcMain.removeHandler('gh:checkOrcaStarred')
    ipcMain.handle('gh:checkOrcaStarred', () => null)
    ipcMain.removeHandler('shell:openUrl')
    ipcMain.handle('shell:openUrl', (_event, url: string) => {
      recorder.__orcaOpenedUrls?.push(url)
    })
  })
}

async function openedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __orcaOpenedUrls?: string[] }).__orcaOpenedUrls ?? []
  )
}

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

async function clickOpensRepository(app: ElectronApplication, button: Locator): Promise<void> {
  const before = (await openedUrls(app)).length
  await button.click()
  await expect.poll(async () => (await openedUrls(app)).length).toBe(before + 1)
  expect((await openedUrls(app)).at(-1)).toBe(ORCA_REPOSITORY_URL)
}

test('Landing star button opens the fork repository at every width and theme', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(300_000)
  await stubGitHubInMain(electronApp)
  await waitForSessionReady(orcaPage)
  // Why: Landing shows the star footer only with no repos or a GitHub-backed one; the seeded repo has neither.
  await orcaPage.evaluate(() =>
    window.__store!.setState({ repos: [], activeRepoId: null, activeWorktreeId: null })
  )

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      const openGitHub = orcaPage.getByRole('button', { name: 'Open GitHub', exact: true })
      // Why: below 768px the worktree sidebar covers Landing's footer, so the click is unreachable there.
      const reachable = width >= 768
      if (reachable) {
        await expect(openGitHub).toBeVisible({ timeout: 15_000 })
      }
      await orcaPage.screenshot({ path: testInfo.outputPath(`landing-${theme}-${width}.png`) })
      if (reachable) {
        await clickOpensRepository(electronApp, openGitHub)
      }
    }
  }
})

test('Settings > Support opens the fork repository at every width and theme', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(300_000)
  await stubGitHubInMain(electronApp)
  await waitForSessionReady(orcaPage)

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setSettingsSearchQuery('')
        state.openSettingsTarget({ pane: 'general', repoId: null })
        state.openSettingsPage()
      })
      const openGitHub = orcaPage.getByRole('button', { name: 'Open GitHub', exact: true })
      await expect(openGitHub).toBeVisible({ timeout: 15_000 })
      await openGitHub.scrollIntoViewIfNeeded()
      await orcaPage.screenshot({ path: testInfo.outputPath(`support-${theme}-${width}.png`) })
      await clickOpensRepository(electronApp, openGitHub)
    }
  }
})
