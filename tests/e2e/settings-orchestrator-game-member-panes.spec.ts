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

const savedProjects = (page: Page) =>
  page.evaluate(async () => (await window.api.settings.get()).orchestratorGameProjects)

test("the project lead's Game in member panes switch saves this machine's choice and renders at every width", async ({
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
  const lead = orcaPage.locator('[data-slot="game-lead-settings"]')
  const memberGame = lead.getByRole('radiogroup', { name: 'Game in member panes' })
  await expect(memberGame).toBeVisible({ timeout: 15_000 })
  // Unset: the row inherits, and a launched member loads the game unless a layer turns it off.
  await expect(memberGame.getByRole('radio').first()).toBeChecked()
  await expect(memberGame.getByRole('radio', { name: 'On' })).not.toBeChecked()

  const shoot = async (state: 'default' | 'on' | 'off') => {
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        // Why: the switch must never be wider than the section it sits in.
        const overflow = await lead.evaluate((section) => {
          const right = section.getBoundingClientRect().right
          return Array.from(section.querySelectorAll('[role="radiogroup"]'))
            .map((element) => element.getBoundingClientRect().right - right)
            .filter((excess) => excess > 0.5)
        })
        expect(overflow, `a lead switch overflows its section at ${width}px`).toEqual([])
        await memberGame.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await orcaPage.screenshot({
          path: testInfo.outputPath(`member-panes-${state}-${theme}-${width}.png`)
        })
      }
    }
    await setWindowWidth(electronApp, orcaPage, 1440)
  }

  await shoot('default')
  await memberGame.getByRole('radio', { name: 'Off' }).click()
  await expect
    .poll(() => savedProjects(orcaPage))
    .toEqual({ [repoId as string]: { orchestrator: { memberGame: false } } })
  await expect(memberGame.getByRole('radio', { name: 'Off' })).toBeChecked()
  await shoot('off')

  await memberGame.getByRole('radio', { name: 'On' }).click()
  await expect
    .poll(() => savedProjects(orcaPage))
    .toEqual({ [repoId as string]: { orchestrator: { memberGame: true } } })
  await expect(memberGame.getByRole('radio', { name: 'On' })).toBeChecked()
  await shoot('on')
})
