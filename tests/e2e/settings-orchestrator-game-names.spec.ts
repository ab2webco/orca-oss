import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
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

const savedProjects = (page: Page) =>
  page.evaluate(async () => (await window.api.settings.get()).orchestratorGameProjects)

// ORCA-1304: the owner found no place to set the names and nothing said where they come from.
test("the project's Names section says the names come from the scene and saves the lead's name", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the harness seeds one repo').not.toBeNull()
  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)
  const names = orcaPage.locator('[data-slot="game-names-settings"]')
  await expect(names).toBeVisible({ timeout: 15_000 })
  await expect(names).toContainText("the scene's roster")
  await expect(names).toContainText('Arthur, Merlin, Lancelot')
  await expect(names).toContainText('from the scene')
  await expect(names).toContainText('Lead, until you name it')

  const shoot = async (state: 'unnamed' | 'named') => {
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        // Why: a field must never be wider than the section it sits in.
        const overflow = await names.evaluate((section) => {
          const right = section.getBoundingClientRect().right
          return Array.from(section.querySelectorAll('input'))
            .map((element) => element.getBoundingClientRect().right - right)
            .filter((excess) => excess > 0.5)
        })
        expect(overflow, `a names field overflows its section at ${width}px`).toEqual([])
        await names.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await orcaPage.screenshot({
          path: testInfo.outputPath(`names-${state}-${theme}-${width}.png`)
        })
      }
    }
    await setWindowWidth(electronApp, orcaPage, 1440)
  }

  await shoot('unnamed')
  const leadName = names.getByRole('textbox', { name: 'Lead name' })
  await leadName.fill('Ada')
  await leadName.press('Enter')
  await expect
    .poll(() => savedProjects(orcaPage))
    .toEqual({ [repoId as string]: { orchestrator: { label: 'Ada' } } })
  await expect(names).toContainText('Ada · this machine')
  await shoot('named')
})
