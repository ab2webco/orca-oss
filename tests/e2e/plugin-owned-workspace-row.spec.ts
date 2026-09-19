/**
 * Invariant: approving a plugin that contributes a `workspace: 'plugin-owned'`
 * automation leaves its row in the Automations list already pointing at the
 * folder Orca created for the plugin, and its detail saying what it takes to
 * start it. Needs E2E: main registers that folder outside every repo IPC, so
 * only the real app proves the renderer catalog learns about it without a
 * restart.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const AUTOMATION_TITLE = 'Inbox sync'
const PLUGIN_NAME = 'Inbox'
const WORKSPACE_LABEL = `${PLUGIN_NAME} (plugin)`
const NO_PROJECT_COPY = 'No project chosen yet'
const PAUSED_HINT = 'A plugin added this automation paused — use Resume to start it.'

const MANIFEST = {
  manifestVersion: 1,
  id: 'inbox',
  publisher: 'orca-samples',
  name: PLUGIN_NAME,
  version: '1.0.0',
  engines: { orca: '>=1.4.0' },
  pluginApi: 1,
  contributes: {
    automations: [
      {
        id: 'inbox-sync',
        title: AUTOMATION_TITLE,
        trigger: '*/5 * * * *',
        timezone: 'UTC',
        command: 'inbox sync --quiet',
        workspace: 'plugin-owned'
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

test('shows the plugin workspace on the row it just contributed', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-owned-workspace-e2e-'))
  const pluginRoot = join(tempRoot, 'inbox')
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(pluginRoot, 'orca-plugin.json'), JSON.stringify(MANIFEST, null, 2))

  try {
    const approved = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const installed = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!installed.ok) {
        throw new Error(installed.error)
      }
      const pending = (await window.api.plugins.refresh()).find(
        (candidate) => candidate.pluginKey === installed.pluginKey
      )
      if (!pending?.consentFingerprint) {
        throw new Error('the installed plugin has no consent fingerprint to approve')
      }
      const entries = await window.api.plugins.consent({
        pluginKey: installed.pluginKey,
        reviewedFingerprint: pending.consentFingerprint,
        decision: 'approve'
      })
      return {
        pluginKey: installed.pluginKey,
        status:
          entries.find((entry) => entry.pluginKey === installed.pluginKey)?.status ?? 'missing'
      }
    }, pluginRoot)

    // Un plugin sin worker queda 'idle' una vez aprobado, nunca 'pending'.
    expect(['idle', 'running']).toContain(approved.status)

    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openAutomationsPage()
    })

    const row = orcaPage
      .locator('[data-slot="context-menu-trigger"]')
      .filter({ hasText: AUTOMATION_TITLE })
    await expect(row).toBeVisible()
    // Esto es la regresion: sin el aviso de `repos:changed` el catalogo del
    // renderer nunca aprende la carpeta y la celda se queda en el fallback.
    await expect(row).toContainText(WORKSPACE_LABEL)
    await expect(row).not.toContainText(NO_PROJECT_COPY)

    // Y la fila apagada tiene que decir que falta, no solo que esta en pausa.
    await row.click()
    const hint = orcaPage.getByText(PAUSED_HINT)
    await expect(hint).toBeVisible()

    for (const width of SCREENSHOT_WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        // Debajo de ~600px el panel se recorta y Playwright lo lee oculto
        // aunque se pinte: alcanza con que siga montado, la captura se mira.
        await expect(hint).toBeAttached()
        await orcaPage.screenshot({
          path: testInfo.outputPath(`plugin-row-${width}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
