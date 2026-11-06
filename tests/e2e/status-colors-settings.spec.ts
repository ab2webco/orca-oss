/**
 * Invariant: a status colour picked in Settings, Appearance repaints the status
 * tone for that theme only, survives in settings, and Reset brings the theme
 * default back (ORCA-1070).
 * Needs E2E: the override is a stylesheet rule keyed on the root theme class, so
 * only a real cascade shows it beating main.css and leaving the other theme alone.
 */

import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

async function applySettings(page: Page, updates: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set(next)
    window.__store?.setState({ settings })
  }, updates)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await applySettings(page, { theme })
  await expect
    .poll(() =>
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
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

function statusInfo(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--status-info').trim()
  )
}

async function openAppearance(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'appearance', repoId: null })
    state.openSettingsPage()
  })
}

test('a picked status colour repaints its theme only and Reset restores it', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  await setTheme(orcaPage, 'dark')
  await openAppearance(orcaPage)

  const picker = orcaPage.locator('input[type="color"][aria-label="Working color"]')
  await expect(picker).toBeVisible()
  expect(await statusInfo(orcaPage)).toBe('#4fc3f7')

  await picker.evaluate((input: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '#ff00aa')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect.poll(() => statusInfo(orcaPage)).toBe('#ff00aa')
  await expect
    .poll(() => orcaPage.evaluate(async () => (await window.api.settings.get()).statusColors))
    .toEqual({ dark: { info: '#ff00aa' } })

  await setTheme(orcaPage, 'light')
  expect(await statusInfo(orcaPage)).toBe('#0369a1')

  await setTheme(orcaPage, 'dark')
  await orcaPage
    .getByRole('radiogroup', { name: 'Theme to edit' })
    .getByRole('radio', { name: 'Dark' })
    .click()
  await orcaPage.getByRole('button', { name: 'Reset status colors' }).click()
  await expect.poll(() => statusInfo(orcaPage)).toBe('#4fc3f7')
})
