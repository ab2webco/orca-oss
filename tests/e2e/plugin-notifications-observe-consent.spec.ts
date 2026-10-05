/**
 * Invariant: a plugin that subscribes to notification.dispatched tells the user,
 * before consent, that it also receives notifications this computer never showed
 * and that their text can quote agent replies, tool input and terminal titles.
 * Needs E2E: the copy travels manifest → main projection → preload wire →
 * translated dialog, and only the real app renders it.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const OBSERVE_COPY =
  'Receive a copy of the notifications Orca Lab raises, even ones this computer does not show, ' +
  'including their text, which can quote agent replies, tool input and terminal titles'
const STALE_COPY = 'the notifications Orca Lab shows you'

const MANIFEST = {
  manifestVersion: 1,
  id: 'notification-bridge',
  publisher: 'orca-samples',
  name: 'Notification Bridge',
  version: '1.0.0',
  engines: { orca: '>=1.4.0' },
  pluginApi: 1,
  main: 'worker.mjs',
  contributes: { events: [{ on: 'notification.dispatched' }] },
  capabilities: [{ kind: 'events:subscribe' }, { kind: 'notifications:observe' }]
}

const SCREENSHOT_WIDTHS = [1440, 768, 390, 320]

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

test('tells the user what a notifications:observe plugin receives before consent', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-observe-e2e-'))
  const pluginRoot = join(tempRoot, 'notification-bridge')
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, 'orca-plugin.json'), JSON.stringify(MANIFEST, null, 2))
  await writeFile(join(pluginRoot, 'worker.mjs'), 'export {}\n')

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
        capabilities: entry?.capabilities.map((capability) => capability.kind) ?? []
      }
    }, pluginRoot)

    expect(installed.status).toBe('pending')
    expect(installed.capabilities).toContain('notifications:observe')

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
    await expect(consent).toContainText(OBSERVE_COPY)
    await expect(consent).toContainText('(notifications:observe)')
    await expect(consent).not.toContainText(STALE_COPY)

    const copy = consent.getByText(OBSERVE_COPY)
    for (const width of SCREENSHOT_WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        await copy.scrollIntoViewIfNeeded()
        await expect(copy).toBeInViewport()
        // The line is the longest consent string; it has to wrap, never clip.
        const clipped = await copy.evaluate((node) => ({
          overflowX: node.scrollWidth - node.clientWidth,
          hiddenY: node.scrollHeight - node.clientHeight
        }))
        expect(clipped.overflowX, `copy clipped horizontally at ${width}px`).toBeLessThanOrEqual(1)
        expect(clipped.hiddenY, `copy clipped vertically at ${width}px`).toBeLessThanOrEqual(1)
        // Without this the shot can catch the dialog mid fade-in and read as translucent.
        await orcaPage.screenshot({
          path: testInfo.outputPath(`consent-${width}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
