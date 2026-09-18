/**
 * Invariant: a plugin whose only contribution is a command-only automation
 * shows the user the shell string it will schedule, and is never described as
 * contributing validated content only. Needs E2E: the command travels manifest
 * → main projection → preload wire → dialog, and only the real app renders it.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const AUTOMATION_TITLE = 'Nightly report sync'
const AUTOMATION_COMMAND =
  'rsync -a --delete "$HOME/Documents/reports/" "$HOME/Backups/reports/" && ' +
  'printf "synced %s\\n" "$(date -u +%FT%TZ)" >> "$HOME/.orca/report-sync.log"'
/** Corre en cada corrida programada, asi que el consentimiento tiene que
 *  mostrarlo igual que al comando. */
const AUTOMATION_PRECHECK =
  'test -d "$HOME/Documents/reports" && [ -n "$(find "$HOME/Documents/reports" -newermt -1day)" ]'
const DECLARATIVE_COPY = 'contributes validated content only'
const USE_TIME_COPY = 'when you or an agent use it'
const SCHEDULE_COPY =
  'it runs on its own schedule — the command below is what Orca Lab will run, at the times ' +
  'shown, whether or not you are here'

const MANIFEST = {
  manifestVersion: 1,
  id: 'report-sync',
  publisher: 'orca-samples',
  name: 'Report Sync',
  version: '1.0.0',
  engines: { orca: '>=1.4.0' },
  pluginApi: 1,
  contributes: {
    automations: [
      {
        id: 'nightly-report-sync',
        title: AUTOMATION_TITLE,
        trigger: '0 3 * * *',
        timezone: 'UTC',
        precheck: AUTOMATION_PRECHECK,
        command: AUTOMATION_COMMAND
      }
    ]
  }
}

const SCREENSHOT_WIDTHS = [1440, 768, 390, 320]

/** Drives the real setting so the whole window repaints, not just the root
 *  class — a screenshot of a half-applied theme is not evidence of one. */
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

/** The main window floors at 600px, so phone widths need the floor lifted
 *  before the resize or the screenshot is of a 600px window. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

test('shows the shell command of a command-only plugin automation before consent', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-automation-e2e-'))
  const pluginRoot = join(tempRoot, 'report-sync')
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, 'orca-plugin.json'), JSON.stringify(MANIFEST, null, 2))

  try {
    const installed = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      const entry = (await window.api.plugins.refresh()).find(
        (candidate) => candidate.pluginKey === result.pluginKey
      )
      return {
        pluginKey: result.pluginKey,
        status: entry?.status ?? 'missing',
        hasWorker: entry?.hasWorker ?? true,
        capabilities: entry?.capabilities.length ?? -1,
        panels: entry?.panels.length ?? -1
      }
    }, pluginRoot)

    expect(installed.status).toBe('pending')
    // The premise of the case: nothing but the automation reaches the dialog.
    expect(installed).toMatchObject({ hasWorker: false, capabilities: 0, panels: 0 })

    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    await expect(orcaPage.locator('[data-settings-section="plugins"]')).toBeVisible()
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    await expect(row).toContainText('Needs review')
    await row.getByRole('button', { name: 'Review & enable' }).click()

    const consent = orcaPage.getByRole('dialog')
    await expect(consent).toBeVisible()
    await expect(consent).toContainText(AUTOMATION_TITLE)
    await expect(consent).toContainText(AUTOMATION_COMMAND)
    await expect(consent).toContainText(AUTOMATION_PRECHECK)
    await expect(consent).toContainText('0 3 * * *')
    await expect(consent).toContainText('Instructional')
    await expect(consent).toContainText(SCHEDULE_COPY)
    await expect(consent).not.toContainText(DECLARATIVE_COPY)
    await expect(consent).not.toContainText(USE_TIME_COPY)

    const shells = [
      {
        name: 'precheck',
        locator: consent.locator('pre').filter({ hasText: AUTOMATION_PRECHECK })
      },
      { name: 'command', locator: consent.locator('pre').filter({ hasText: AUTOMATION_COMMAND }) }
    ]
    for (const width of SCREENSHOT_WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        for (const shell of shells) {
          await expect(shell.locator).toBeVisible()
          // Wrapping is the only thing keeping the command readable this narrow.
          const clipped = await shell.locator.evaluate((node) => ({
            overflowX: node.scrollWidth - node.clientWidth,
            hiddenY: node.scrollHeight - node.clientHeight
          }))
          expect(
            clipped.overflowX,
            `${shell.name} clipped horizontally at ${width}px`
          ).toBeLessThanOrEqual(1)
          expect(
            clipped.hiddenY,
            `${shell.name} clipped vertically at ${width}px`
          ).toBeLessThanOrEqual(1)
        }
        // Without this the shot can catch the dialog mid fade-in and read as translucent.
        await orcaPage.screenshot({
          path: testInfo.outputPath(`consent-${width}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
    // La caja entera scrollea, asi que a 320px el pie queda bajo el pliegue: lo
    // que hay que probar es que se llegue a el, no que entre en la primera vista.
    await setWindowWidth(electronApp, orcaPage, 320)
    await consent.evaluate((node) => node.scrollTo(0, node.scrollHeight))
    await expect(consent.getByRole('button', { name: 'Keep Disabled' })).toBeInViewport()
    await orcaPage.screenshot({
      path: testInfo.outputPath('consent-320-footer.png'),
      animations: 'disabled'
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
