/**
 * Invariant: a `surface: 'nav'` plugin entry shows the counter from its own
 * reserved `navBadge` storage key — capped at `99+`, absent when there is
 * nothing to count, and never leaking to another plugin's entry — and a
 * plugin's own `.svg` icon renders sanitized on both the nav entry and its
 * Settings row, scaled by the surface and themed by `currentColor`.
 * Needs E2E: the badge arrives through a filesystem watcher on the plugin data
 * dir and a full main-process projection refresh, and the icon claims are about
 * what the two pages actually paint.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

/** Declares a hardcoded brand colour and a fixed pixel size on purpose: both
 *  must be gone by the time the sidebar paints it. */
const BRAND_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- exported from the design tool -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512">
  <path d="M12 2a10 10 0 00-8.6 15.1L2 22l4.9-1.4A10 10 0 1012 2z" fill="#25D366"/>
  <circle cx="9" cy="12" r="1.2" fill="#ffffff"/>
  <circle cx="12" cy="12" r="1.2" fill="#ffffff"/>
  <circle cx="15" cy="12" r="1.2" fill="#ffffff"/>
</svg>`

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

/** Copies the sample plugin, renames its identity and replaces what it
 *  contributes; the worker is dropped so the spec only exercises surfaces. */
async function stagePlugin(
  tempRoot: string,
  id: string,
  panels: readonly Record<string, unknown>[]
): Promise<string> {
  const pluginRoot = join(tempRoot, id)
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  await mkdir(join(pluginRoot, 'assets'), { recursive: true })
  await writeFile(join(pluginRoot, 'assets', 'brand.svg'), BRAND_SVG)
  const manifestPath = join(pluginRoot, 'orca-plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.id = id
  manifest.name = id
  delete manifest.main
  manifest.contributes = { panels }
  manifest.capabilities = [{ kind: 'storage' }]
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return pluginRoot
}

async function installAndEnable(page: Page, sourcePath: string): Promise<string> {
  const installed = await page.evaluate(async (path) => {
    const result = await window.api.plugins.install({ kind: 'local-path', path })
    if (!result.ok) {
      throw new Error(result.error)
    }
    await window.api.plugins.refresh()
    return { pluginKey: result.pluginKey }
  }, sourcePath)
  const row = page.locator(`[data-plugin-key="${installed.pluginKey}"]`)
  await row.getByRole('button', { name: 'Review & enable' }).click()
  const consent = page.getByRole('dialog', { name: 'Review permissions' })
  await consent.getByRole('button', { name: 'Enable plugin' }).click()
  await expect(consent).toBeHidden()
  await expect(row).toContainText('Enabled')
  return installed.pluginKey
}

test('badges a nav entry from plugin storage and paints the plugin own icon', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-nav-badge-e2e-'))
  const badgedRoot = await stagePlugin(tempRoot, 'wa', [
    {
      id: 'inbox',
      title: 'Messages',
      icon: 'assets/brand.svg',
      entry: 'panel.html',
      surface: 'nav'
    },
    {
      id: 'registry',
      title: 'Registry',
      icon: 'assets/brand.svg',
      entry: 'panel.html',
      surface: 'settings'
    }
  ])
  // Control: a second plugin with a nav entry that never writes `navBadge`.
  const quietRoot = await stagePlugin(tempRoot, 'quiet', [
    { id: 'hours', title: 'Quiet hours', icon: 'bell', entry: 'panel.html', surface: 'nav' }
  ])

  try {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 900)
    })

    await orcaPage.evaluate(async () => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const badgedKey = await installAndEnable(orcaPage, badgedRoot)
    await installAndEnable(orcaPage, quietRoot)

    // --- Settings row: the plugin's own icon, at the Settings row's size ---
    const registryRow = orcaPage.getByRole('button', { name: 'Registry', exact: true })
    await expect(registryRow).toBeVisible({ timeout: 15_000 })
    const registryIcon = registryRow.locator('svg').first()
    await expect(registryIcon).toHaveAttribute('viewBox', '0 0 24 24')
    // The file said 512x512; the surface decides the size, not the plugin.
    expect(await registryIcon.getAttribute('width')).toBeNull()
    // And it says #25D366 nowhere: the host repainted it onto the theme.
    expect(await registryIcon.innerHTML()).not.toContain('25D366')
    expect(await registryIcon.locator('path').first().getAttribute('fill')).toBe('currentColor')

    // The PLUGINS group sits below the fold; a screenshot of the unscrolled
    // sidebar would prove nothing about the row this spec is checking.
    await registryRow.scrollIntoViewIfNeeded()
    await registryRow.click()
    await expect(registryRow).toBeInViewport()

    await setTheme(orcaPage, 'light')
    await orcaPage.screenshot({ path: testInfo.outputPath('settings-icon-1440-light.png') })
    await setTheme(orcaPage, 'dark')
    await orcaPage.screenshot({ path: testInfo.outputPath('settings-icon-1440-dark.png') })

    await orcaPage.evaluate(() => {
      window.__store?.getState().closeSettingsPage()
    })

    // --- Nav entries: one badged, one control that never is ---
    const messages = orcaPage.getByRole('button', { name: /^Messages/ })
    const quiet = orcaPage.getByRole('button', { name: /^Quiet hours/ })
    await expect(messages).toBeVisible({ timeout: 15_000 })
    await expect(quiet).toBeVisible()
    expect(await messages.textContent()).toBe('Messages')

    const userDataPath: string = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const storageDir = join(userDataPath, 'plugins-data', badgedKey)
    const storagePath = join(storageDir, 'storage.json')
    await mkdir(storageDir, { recursive: true })

    // No refresh call: an external write to the plugin's own KV has to reach
    // the sidebar on its own, which is what the data-dir watcher is for.
    await writeFile(storagePath, JSON.stringify({ navBadge: { count: 7 } }, null, 2))
    await expect(messages).toHaveText('Messages7', { timeout: 15_000 })
    // One plugin's counter never reaches another plugin's entry.
    expect(await quiet.textContent()).toBe('Quiet hours')

    const navIcon = messages.locator('svg').first()
    await expect(navIcon).toHaveAttribute('viewBox', '0 0 24 24')
    expect(await navIcon.getAttribute('width')).toBeNull()

    await setTheme(orcaPage, 'light')
    await orcaPage.screenshot({ path: testInfo.outputPath('nav-badge-1440-light.png') })
    await setTheme(orcaPage, 'dark')
    await orcaPage.screenshot({ path: testInfo.outputPath('nav-badge-1440-dark.png') })

    // --- The cap, and the values that must show nothing ---
    await writeFile(storagePath, JSON.stringify({ navBadge: { count: 1240 } }, null, 2))
    await expect(messages).toHaveText('Messages99+', { timeout: 15_000 })
    await orcaPage.screenshot({ path: testInfo.outputPath('nav-badge-1440-dark-capped.png') })

    await writeFile(storagePath, JSON.stringify({ navBadge: { count: 0 } }, null, 2))
    // A count of zero must clear the badge, never leave a dangling "0".
    await expect(messages).toHaveText('Messages', { timeout: 15_000 })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
