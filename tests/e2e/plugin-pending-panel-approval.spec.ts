/**
 * Invariant: while a plugin waits for consent, every surface it contributes
 * renders the approval notice instead of the plugin's own panel — and names
 * a first install apart from an update that re-opened consent. Serving the
 * panel there impersonates a working plugin: the host spawns no worker, so it
 * takes input and answers nothing. Needs E2E: install, consent and the panel
 * document are IPC round-trips, and the claim is about what the page renders.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const PANELS = [
  { id: 'hello', title: 'Hello Orca', icon: 'plug', entry: 'panel.html' },
  { id: 'inbox', title: 'Messages', icon: 'bell', entry: 'panel.html', surface: 'nav' },
  { id: 'registry', title: 'Registry', icon: 'file-text', entry: 'panel.html', surface: 'settings' }
]

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

/** The left sidebar is a fixed 280px, so at phone widths it leaves the page
 *  about 40px — every nav page, not just this one. Fold it to measure the
 *  notice instead of the chrome. */
async function setSidebarOpen(page: Page, open: boolean): Promise<void> {
  await page.evaluate((next) => {
    const state = window.__store?.getState()
    if (state && state.sidebarOpen !== next) {
      state.toggleSidebar()
    }
  }, open)
  await expect
    .poll(async () => page.evaluate(() => window.__store?.getState().sidebarOpen))
    .toBe(open)
}

/** Overflow in either axis of the element's own box. */
async function clippedPixels(locator: ReturnType<Page['locator']>): Promise<number> {
  return locator.evaluate((node) =>
    Math.max(node.scrollWidth - node.clientWidth, node.scrollHeight - node.clientHeight)
  )
}

test('serves the approval notice over the panels of a plugin awaiting consent', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-pending-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-orca')
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  const manifestPath = join(pluginRoot, 'orca-plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.contributes.panels = PANELS
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  try {
    const installed = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      await window.api.plugins.refresh()
      return { pluginKey: result.pluginKey }
    }, pluginRoot)

    const navEntry = orcaPage.getByRole('button', { name: 'Messages', exact: true })
    // La destinacion sobrevive a la espera: si desaparece, el usuario no tiene
    // donde enterarse de que falta aprobar el plugin.
    await expect(navEntry).toBeVisible({ timeout: 15_000 })
    await navEntry.click()
    const notice = orcaPage.locator('[data-testid="plugin-pending-approval"]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('Hello Orca is waiting for your approval')
    await expect(orcaPage.locator('iframe[title="Messages"]')).toHaveCount(0)

    for (const width of [1440, 320]) {
      await setWindowWidth(electronApp, orcaPage, width)
      // La barra lateral mide 280px fijos, asi que a 320 se come la pagina
      // entera — igual que en Automations. Plegarla mide el aviso, no el chrome.
      await setSidebarOpen(orcaPage, width > 600)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        const action = notice.getByRole('button', { name: 'Review & enable' })
        // El boton es la accion: recortado, la pantalla no sirve para lo unico
        // que tiene que hacer.
        expect(await clippedPixels(notice), `notice clipped at ${width}px`).toBeLessThanOrEqual(1)
        expect(await clippedPixels(action), `action clipped at ${width}px`).toBeLessThanOrEqual(1)
        await expect(action).toBeInViewport()
        await orcaPage.screenshot({
          path: testInfo.outputPath(`pending-install-nav-${width}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
    await setSidebarOpen(orcaPage, true)

    await setWindowWidth(electronApp, orcaPage, 1440)
    await setTheme(orcaPage, 'dark')
    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    const registryRow = orcaPage.getByRole('button', { name: 'Registry', exact: true })
    await expect(registryRow).toBeVisible({ timeout: 15_000 })
    await registryRow.click()
    const settingsNotice = orcaPage
      .locator(`[data-settings-section="plugin:${installed.pluginKey}/registry"]`)
      .locator('[data-testid="plugin-pending-approval"]')
    await expect(settingsNotice).toBeVisible()
    await expect(orcaPage.locator('iframe[title="Registry"]')).toHaveCount(0)
    await orcaPage.screenshot({
      path: testInfo.outputPath('pending-install-settings-1440-dark.png'),
      animations: 'disabled'
    })

    // El boton lleva al unico lugar que puede conceder la aprobacion.
    await settingsNotice.getByRole('button', { name: 'Review & enable' }).click()
    await expect(orcaPage.locator('[data-settings-section="plugins"]')).toBeVisible()
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    await expect(row).toContainText('Needs review')
    await row.getByRole('button', { name: 'Review & enable' }).click()
    const consent = orcaPage.getByRole('dialog', { name: 'Review permissions' })
    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()
    await expect(row).toContainText('Enabled')

    await orcaPage.evaluate(() => {
      window.__store?.getState().closeSettingsPage()
    })
    await navEntry.click()
    // Aprobado, el panel real vuelve: el aviso no se queda pegado.
    await expect(orcaPage.locator('iframe[title="Messages"]')).toBeVisible({ timeout: 15_000 })
    await expect(orcaPage.locator('[data-testid="plugin-pending-approval"]')).toHaveCount(0)

    // Una actualizacion mueve la huella de consentimiento, que es el caso comun.
    const updatedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    updatedManifest.version = '1.1.0'
    updatedManifest.capabilities = [...updatedManifest.capabilities, { kind: 'settings:own' }]
    await writeFile(manifestPath, JSON.stringify(updatedManifest, null, 2))
    await orcaPage.evaluate(async (sourcePath) => {
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      await window.api.plugins.refresh()
    }, pluginRoot)

    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText('Hello Orca was updated and needs your approval again')
    await expect(orcaPage.locator('iframe[title="Messages"]')).toHaveCount(0)
    for (const [width, theme] of [
      [1440, 'dark'],
      [320, 'light']
    ] as const) {
      await setWindowWidth(electronApp, orcaPage, width)
      await setSidebarOpen(orcaPage, width > 600)
      await setTheme(orcaPage, theme)
      await expect(notice.getByRole('button', { name: 'Review & enable' })).toBeInViewport()
      await orcaPage.screenshot({
        path: testInfo.outputPath(`pending-update-nav-${width}-${theme}.png`),
        animations: 'disabled'
      })
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
