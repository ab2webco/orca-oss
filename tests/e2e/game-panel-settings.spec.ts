/**
 * Invariant: the panel gear's two Settings targets land on their section, the project's game
 * section and Agents > Panel, and both render at every width in both themes and languages.
 * Needs E2E: the scroll to a section id happens in the real Settings page after navigation.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const
const LANGUAGES = ['en', 'es'] as const

async function applySettings(page: Page, patch: Record<string, string>): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set(next)
    window.__store?.setState({ settings })
  }, patch)
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

/** What the gear does: target first, then the page, as `openGamePanelSettings` calls them. */
async function openTarget(page: Page, repoId: string | null): Promise<string> {
  return page.evaluate((id) => {
    const store = window.__store!.getState()
    const sectionId = id ? `repo-${id}-game` : 'agents-game-panel'
    store.openSettingsTarget(
      id ? { pane: 'repo', repoId: id, sectionId } : { pane: 'agents', repoId: null, sectionId }
    )
    store.openSettingsPage()
    return sectionId
  }, repoId)
}

async function expectSectionInView(page: Page, sectionId: string): Promise<void> {
  const section = page.locator(`[id="${sectionId}"]`)
  await expect(section).toBeVisible({ timeout: 15_000 })
  await expect(section).toBeInViewport({ timeout: 15_000 })
}

test('the panel gear opens the project game section and Agents > Panel', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(600_000)
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the fixture seeds a repo').not.toBeNull()

  for (const language of LANGUAGES) {
    await applySettings(orcaPage, { uiLanguage: language })
    for (const theme of THEMES) {
      await applySettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        for (const [name, target] of [
          ['project', repoId],
          ['global', null]
        ] as const) {
          const sectionId = await openTarget(orcaPage, target)
          await expectSectionInView(orcaPage, sectionId)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${name}-${language}-${theme}-${width}.png`)
          })
          await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
        }
      }
    }
  }
})
