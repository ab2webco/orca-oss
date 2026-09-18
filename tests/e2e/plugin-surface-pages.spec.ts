/**
 * Invariant: a `surface: 'settings'` panel renders as its own Settings page and
 * a `surface: 'nav'` panel as its own left-sidebar destination — neither inside
 * the plugin card, and neither beside the per-worktree right sidebar.
 * Needs E2E: install and consent are IPC round-trips through the main process,
 * and both claims are about what the page actually renders.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'

test('renders settings-surface and nav-surface panels as their own pages', async ({ orcaPage }) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-surfaces-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-orca')
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  const manifestPath = join(pluginRoot, 'orca-plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.contributes.panels = [
    { id: 'hello', title: 'Hello Orca', icon: 'plug', entry: 'panel.html' },
    { id: 'inbox', title: 'Messages', icon: 'bell', entry: 'panel.html', surface: 'nav' },
    {
      id: 'registry',
      title: 'Registry',
      icon: 'file-text',
      entry: 'panel.html',
      surface: 'settings'
    }
  ]
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

    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    await expect(orcaPage.locator('[data-settings-section="plugins"]')).toBeVisible()
    // A group header with no rows under it is worse than no group: while the
    // plugin is still pending there is no settings page, so no PLUGINS group.
    const pluginsGroupHeading = orcaPage.locator('p', { hasText: /^Plugins$/ })
    await expect(pluginsGroupHeading).toHaveCount(0)
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    await row.getByRole('button', { name: 'Review & enable' }).click()
    const consent = orcaPage.getByRole('dialog', { name: 'Review permissions' })
    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()
    await expect(row).toContainText('Enabled')

    // The card carries install / permissions / logs only.
    expect(await row.textContent()).not.toContain('Show panel')
    expect(await row.locator('iframe').count()).toBe(0)

    await expect(pluginsGroupHeading).toHaveCount(1)

    const registryRow = orcaPage.getByRole('button', { name: 'Registry', exact: true })
    await expect(registryRow).toBeVisible({ timeout: 15_000 })
    await registryRow.click()
    const registryPanel = orcaPage
      .locator(`[data-settings-section="plugin:${installed.pluginKey}/registry"]`)
      .locator('iframe[title="Registry"]')
    await expect(registryPanel).toBeVisible()
    // A page, not a card in a two-column grid: the panel takes the page's height.
    expect(
      await registryPanel.evaluate((node) => node.getBoundingClientRect().height)
    ).toBeGreaterThan(400)

    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.closeSettingsPage()
    })
    const navEntry = orcaPage.getByRole('button', { name: 'Messages', exact: true })
    await expect(navEntry).toBeVisible({ timeout: 15_000 })
    await navEntry.click()
    await expect(navEntry).toHaveAttribute('aria-current', 'page')
    await expect(orcaPage.locator('iframe[title="Messages"]')).toBeVisible()
    // The per-worktree rail stays out of a global plugin page.
    await expect(orcaPage.getByRole('button', { name: 'Toggle right sidebar' })).toBeHidden()
    // Each panel belongs to one surface only.
    expect(await orcaPage.locator('iframe[title="Registry"]').count()).toBe(0)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
