/**
 * Invariant: a plugin's declared skills reach agents only through visible
 * consent. The dialog names the `skills:contribute` grant, discovery attributes
 * the skill to the plugin that shipped it, and disabling withdraws it.
 */

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const SKILL_MARKDOWN = `---
name: hello-orca-skill
description: Ping the Hello Orca plugin from any project.
---

Run \`orca plugins invoke orca-samples.hello-orca hello-ping\`.
`

const CONSENT_COPY =
  'Teach every agent, in every project, how to use this plugin: its skill ' +
  'instructions are served to any agent that asks for them'

const SCREENSHOT_WIDTHS = [1440, 768, 390, 320]

async function openPluginSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'plugins', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.locator('[data-settings-section="plugins"]')).toBeVisible()
}

async function discoveredSkillLabels(page: Page, name: string): Promise<string[]> {
  return page.evaluate(async (skillName) => {
    const result = await window.api.skills.discover({ refresh: true })
    return result.skills
      .filter((skill) => skill.name === skillName)
      .map((skill) => skill.sourceLabel)
  }, name)
}

test('serves a plugin skill to every agent only after its capability is approved', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-plugin-skills-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-orca')
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  await mkdir(join(pluginRoot, 'skills', 'hello-orca-skill'), { recursive: true })
  await writeFile(join(pluginRoot, 'skills', 'hello-orca-skill', 'SKILL.md'), SKILL_MARKDOWN)
  await writeFile(
    join(pluginRoot, 'orca-plugin.json'),
    JSON.stringify(
      {
        manifestVersion: 1,
        id: 'hello-orca',
        publisher: 'orca-samples',
        name: 'Hello Orca',
        version: '1.0.0',
        engines: { orca: '>=1.4.0' },
        pluginApi: 1,
        contributes: { skills: [{ path: 'skills/hello-orca-skill' }] },
        capabilities: [{ kind: 'skills:contribute' }]
      },
      null,
      2
    )
  )

  try {
    const installed = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      const pending = (await window.api.plugins.refresh()).find(
        (entry) => entry.pluginKey === result.pluginKey
      )
      return { pluginKey: result.pluginKey, status: pending?.status ?? 'missing' }
    }, pluginRoot)

    expect(installed.status).toBe('pending')
    // Installed but unconsented contributes nothing: the whole point of the gate.
    expect(await discoveredSkillLabels(orcaPage, 'hello-orca-skill')).toEqual([])

    await openPluginSettings(orcaPage)
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    await expect(row).toContainText('Needs review')
    await row.getByRole('button', { name: 'Review & enable' }).click()
    const consent = orcaPage.getByRole('dialog')
    await expect(consent).toBeVisible()
    await expect(consent).toContainText(CONSENT_COPY)
    await expect(consent).toContainText('(skills:contribute)')
    // Instructional, not panel content: a skill is read and acted on by an agent.
    await expect(consent).toContainText('Instructional')

    for (const width of SCREENSHOT_WIDTHS) {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setSize(size, 900)
      }, width)
      await expect(consent).toBeVisible()
      await orcaPage.screenshot({ path: testInfo.outputPath(`consent-${width}.png`) })
    }
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 900)
    })

    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()
    await expect(row).toContainText('Enabled')

    await expect
      .poll(() => discoveredSkillLabels(orcaPage, 'hello-orca-skill'), { timeout: 15_000 })
      .toEqual(['Orca plugin Hello Orca'])

    await orcaPage.evaluate(
      async (pluginKey) => window.api.plugins.setEnabled({ pluginKey, enabled: false }),
      installed.pluginKey
    )
    await expect
      .poll(() => discoveredSkillLabels(orcaPage, 'hello-orca-skill'), { timeout: 15_000 })
      .toEqual([])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
