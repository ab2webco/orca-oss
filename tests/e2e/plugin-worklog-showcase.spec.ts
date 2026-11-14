import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'
import { writeSettings } from './helpers/settings-write'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site plugins clip. The author and entries are invented
// demo data, seeded through the worker because headless clicks never reach the
// panel iframe (see plugin-worklog-example.spec.ts).
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 1_800
const DEMO_AUTHOR = 'Rowan Vale'
const DEMO_ENTRIES = [
  'Shipped LUM-12: dark mode toggle',
  'Reviewed LUM-14: offline cache',
  'Paired on LUM-15: onboarding copy'
]

test('installs, reviews, enables and opens the worklog plugin with entries', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-worklog-showcase-'))
  const pluginRoot = join(tempRoot, 'worklog')
  await cp(join(process.cwd(), 'examples', 'plugins', 'worklog'), pluginRoot, { recursive: true })

  // Why: each beat holds long enough to read before the next action.
  const hold = () => orcaPage.waitForTimeout(HOLD_MS)

  try {
    // Pinned before the panel mounts: a theme switch rebuilds its document (ORCA-753).
    await writeSettings(orcaPage, { pluginSystemEnabled: true, theme: 'dark' })
    const pluginKey = await orcaPage.evaluate(async (sourcePath) => {
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      await window.api.plugins.refresh()
      return result.pluginKey
    }, pluginRoot)

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setSettingsSearchQuery('')
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    await expect(orcaPage.locator('[data-settings-section="plugins"]')).toBeVisible()
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${pluginKey}"]`)
    await expect(row).toContainText('Needs review')
    const clip = await showcaseClip(electronApp, testInfo, 'worklog-plugin')
    await hold()

    await row.getByRole('button', { name: 'Review & enable' }).click()
    const consent = orcaPage.getByRole('dialog', { name: 'Review access and content' })
    await expect(consent).toContainText('0 18 * * 1-5')
    await hold()

    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()
    await expect(row).toContainText('Enabled')

    await orcaPage.evaluate(
      async ({ key, author, entries }) => {
        await window.api.plugins.setSetting({ pluginKey: key, key: 'author', value: author })
        for (const text of entries) {
          await window.api.plugins.invokeCommand({
            pluginKey: key,
            commandId: 'worklog.note',
            args: { text }
          })
        }
        await window.api.plugins.invokeCommand({
          pluginKey: key,
          commandId: 'worklog.publish-settings'
        })
      },
      { key: pluginKey, author: DEMO_AUTHOR, entries: DEMO_ENTRIES }
    )

    await orcaPage.getByRole('button', { name: 'Worklog', exact: true }).click()
    const panel = orcaPage.frameLocator('iframe[title="Worklog"]')
    await expect(panel.locator('#settings')).toContainText(DEMO_AUTHOR, { timeout: 20_000 })
    await expect(panel.locator('#status')).toHaveText('', { timeout: 20_000 })
    for (const text of DEMO_ENTRIES) {
      await expect(panel.locator('#entries')).toContainText(text)
    }
    await hold()
    await orcaPage.waitForTimeout(1_500)
    await clip.stop()
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
