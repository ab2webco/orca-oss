/**
 * Invariant: at phone widths Settings > Actions keeps V30's lines whole: each project row's command
 * line in full, the new action's preview label and icon picker on one line, the upload icon chosen.
 * Needs E2E: wrapping and clipping only exist with real layout, which happy-dom does not do.
 */

import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const WIDTHS = [390, 320] as const
// Why: the theme captures outrun the CI budget; ORCA_CAPTURE_EVIDENCE=1 saves them locally.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'

const ORCA_YAML = [
  'orchestratorGame:',
  '  actions:',
  '    - label: Release',
  '      command: release',
  '      icon: tag',
  '      pin: true',
  '      prompt: Prepare the release and tell me what is missing.',
  '    - label: Board',
  '      command: board',
  '      icon: list',
  '      mcp: { server: plane, tool: list_work_items }',
  ''
].join('\n')

async function applySettings(page: Page, patch: Record<string, string>): Promise<void> {
  await writeSettings(page, patch)
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

/** How many lines a text box takes, and whether it is cut short. */
async function lineFit(text: Locator): Promise<{ lines: number; clipped: boolean }> {
  return text.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
    return { lines: tops.size, clipped: node.scrollWidth > node.clientWidth }
  })
}

// Why: the seeded repo is shared by the worker; this test's orca.yaml must not reach the next test.
test.afterEach(({ testRepoPath }) => {
  rmSync(path.join(testRepoPath, 'orca.yaml'), { force: true })
})

test('Settings > Actions keeps V30 lines whole at 390 and 320', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 300_000 : 120_000)
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
  const repo = await orcaPage.evaluate(() => {
    const first = window.__store!.getState().repos[0]
    return first ? { id: first.id } : null
  })
  expect(repo, 'the fixture seeds a repo').not.toBeNull()
  writeFileSync(path.join(testRepoPath, 'orca.yaml'), ORCA_YAML)
  const sectionId = `repo-${repo!.id}-game-actions`
  await orcaPage.evaluate(
    ({ id, section }) => {
      const store = window.__store!.getState()
      store.openSettingsTarget({ pane: 'repo', repoId: id, sectionId: section })
      store.openSettingsPage()
    },
    { id: repo!.id, section: sectionId }
  )
  const section = orcaPage.locator(`[id="${sectionId}"]`)
  await expect(section).toBeVisible({ timeout: 15_000 })
  const rows = section.locator('[data-slot="game-action-row"]')
  await expect(rows).toHaveCount(7)
  const form = section.locator('[data-slot="game-action-form"]')

  for (const language of ['en', 'es'] as const) {
    await applySettings(orcaPage, { uiLanguage: language, theme: 'dark' })
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      const where = `${width}px ${language}`
      for (const at of [0, 1]) {
        const commandLine = rows.nth(at).locator('small')
        await expect(commandLine).toContainText(at === 0 ? '/release · ' : '/board · MCP plane')
        // Why lines are only reported: the row may wrap at the dot, but never cut the line short.
        const fit = await lineFit(commandLine)
        expect.soft(fit.clipped, `row ${at} command line cut short at ${where}`).toBe(false)
        testInfo.annotations.push({
          type: 'lines',
          description: `row ${at} ${where}: ${fit.lines}`
        })
      }

      await section.getByRole('button', { name: /^(New action|Nueva acción)$/ }).click()
      await expect(form).toBeVisible()
      await expect
        .soft(form.getByRole('radio', { name: /ship$/ }))
        .toHaveAttribute('aria-checked', 'true')
      const preview = form.getByText(/^(Preview|Vista previa)$/)
      expect.soft(await lineFit(preview), `preview label at ${where}`).toEqual({
        lines: 1,
        clipped: false
      })
      for (const whole of [/^(Name|Nombre)$/, /^\/(command|comando)$/]) {
        const fit = await lineFit(form.getByText(whole))
        expect.soft(fit.clipped, `preview ${whole} cut short at ${where}`).toBe(false)
      }
      const iconTops = await form
        .getByRole('radiogroup', { name: /^(Icon|Icono)$/ })
        .getByRole('radio')
        .evaluateAll((icons) => [...new Set(icons.map((one) => one.getBoundingClientRect().top))])
      expect.soft(iconTops, `icon picker lines at ${where}`).toHaveLength(1)

      if (CAPTURE_EVIDENCE && language === 'es') {
        for (const theme of ['dark', 'light'] as const) {
          await applySettings(orcaPage, { theme })
          await section.evaluate((node) => node.scrollIntoView({ block: 'start' }))
          await orcaPage.screenshot({ path: testInfo.outputPath(`form-${width}-${theme}.png`) })
        }
      }
      await form.getByRole('button', { name: /^(Cancel|Cancelar)$/ }).click()
      await expect(form).toHaveCount(0)
      if (CAPTURE_EVIDENCE && language === 'es') {
        for (const theme of ['dark', 'light'] as const) {
          await applySettings(orcaPage, { theme })
          await rows.nth(0).evaluate((node) => node.scrollIntoView({ block: 'center' }))
          await orcaPage.screenshot({ path: testInfo.outputPath(`actions-${width}-${theme}.png`) })
        }
        await applySettings(orcaPage, { theme: 'dark' })
      }
    }
  }
})
