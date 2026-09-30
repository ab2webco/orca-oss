/**
 * Invariant: a `surface: 'nav'` plugin page can always be left — from Orca's
 * own close button, from Escape in the host chrome, and from the panel itself
 * through `panel.close` — and leaving returns to the view the user came from.
 * Needs E2E: the close request crosses the sandboxed frame, the renderer
 * bridge and main's session check, and the claim is about what the page shows.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const PANEL_HTML = `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 16px; color: var(--foreground); background: var(--background); }
    </style>
  </head>
  <body>
    <h1>Inbox</h1>
    <p>Plugin content.</p>
    <button id="close">Close from inside the panel</button>
    <script>
      'use strict'
      document.getElementById('close').addEventListener('click', function () {
        window.parent.postMessage(
          { type: 'orca-panel-action', requestId: 'close-1', action: 'panel.close' },
          '*'
        )
      })
    </script>
  </body>
</html>
`

async function installNavPlugin(page: Page, tempRoot: string): Promise<string> {
  const pluginRoot = join(tempRoot, 'hello-orca')
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  const manifestPath = join(pluginRoot, 'orca-plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.contributes.panels = [
    { id: 'inbox', title: 'Inbox', icon: 'bell', entry: 'nav-panel.html', surface: 'nav' }
  ]
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  await writeFile(join(pluginRoot, 'nav-panel.html'), PANEL_HTML)

  const pluginKey = await page.evaluate(async (sourcePath) => {
    const settings = await window.api.settings.set({ pluginSystemEnabled: true })
    window.__store?.setState({ settings })
    const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
    if (!result.ok) {
      throw new Error(result.error)
    }
    await window.api.plugins.refresh()
    return result.pluginKey
  }, pluginRoot)

  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'plugins', repoId: null })
    state.openSettingsPage()
  })
  await page.getByRole('tab', { name: /^Installed/ }).click()
  const row = page.locator(`[data-plugin-key="${pluginKey}"]`)
  await row.getByRole('button', { name: 'Review & enable' }).click()
  const consent = page.getByRole('dialog', { name: 'Review permissions' })
  await consent.getByRole('button', { name: 'Enable plugin' }).click()
  await expect(consent).toBeHidden()
  await page.evaluate(() => window.__store!.getState().closeSettingsPage())
  return pluginKey
}

async function activeView(page: Page): Promise<string> {
  return page.evaluate(() => window.__store!.getState().activeView)
}

async function openInbox(page: Page): Promise<void> {
  const navEntry = page.getByRole('button', { name: 'Inbox', exact: true })
  await expect(navEntry).toBeVisible({ timeout: 15_000 })
  await navEntry.click()
  await expect(page.locator('iframe[title="Inbox"]')).toBeVisible()
  await expect(page.frameLocator('iframe[title="Inbox"]').locator('h1')).toBeVisible({
    timeout: 15_000
  })
}

test('a nav plugin page closes from the host button, Escape and panel.close', async ({
  orcaPage
}) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-nav-close-e2e-'))
  try {
    await installNavPlugin(orcaPage, tempRoot)
    const before = await activeView(orcaPage)
    expect(before).not.toBe('plugin')

    await openInbox(orcaPage)
    const close = orcaPage.getByRole('button', { name: 'Close Inbox' })
    await expect(close).toBeVisible()
    await expect(orcaPage.getByRole('heading', { name: 'Inbox' })).toBeVisible()

    await close.click()
    await expect(orcaPage.locator('iframe[title="Inbox"]')).toHaveCount(0)
    expect(await activeView(orcaPage)).toBe(before)

    await openInbox(orcaPage)
    await orcaPage.getByRole('button', { name: 'Inbox', exact: true }).focus()
    await orcaPage.keyboard.press('Escape')
    await expect(orcaPage.locator('iframe[title="Inbox"]')).toHaveCount(0)
    expect(await activeView(orcaPage)).toBe(before)

    await openInbox(orcaPage)
    await orcaPage
      .frameLocator('iframe[title="Inbox"]')
      .getByRole('button', { name: 'Close from inside the panel' })
      .click()
    await expect(orcaPage.locator('iframe[title="Inbox"]')).toHaveCount(0)
    expect(await activeView(orcaPage)).toBe(before)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
