/**
 * Invariant: Settings > Actions draws prototype V30's editor for the project's orca.yaml actions
 * and Orca's own, and a change made there reaches this machine's layer at every width.
 * Needs E2E: the section is reached by its id in the real Settings page, and orca.yaml is read from disk.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320] as const
// Why: the capture matrix outruns the CI test budget; ORCA_CAPTURE_EVIDENCE=1 runs it locally.
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
  '      mcp: { server: plane, tool: list_work_items }',
  '  orcaActions:',
  '    sweep: { prompt: Close only with CI green. }',
  ''
].join('\n')

async function applySettings(page: Page, patch: Record<string, string>): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set(next)
    window.__store?.setState({ settings })
  }, patch)
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

// Why: the app's star and update cards can open over the page's lower right, where the switches are.
async function dismissAppCards(page: Page): Promise<void> {
  for (const name of [/^(Later|Más tarde)$/, /^(Dismiss|Descartar)$/]) {
    for (const one of await page.getByRole('button', { name }).all()) {
      if (await one.isVisible().catch(() => false)) {
        await one.click()
      }
    }
  }
}

test('Settings > Actions edits the project actions and Orca ones, as V30', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 600_000 : 180_000)
  await waitForSessionReady(orcaPage)
  const repo = await orcaPage.evaluate(() => {
    const first = window.__store!.getState().repos[0]
    return first ? { id: first.id, path: first.path } : null
  })
  expect(repo, 'the fixture seeds a repo').not.toBeNull()
  writeFileSync(path.join(repo!.path, 'orca.yaml'), ORCA_YAML)
  await applySettings(orcaPage, { uiLanguage: 'en' })
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
  await expect(section).toBeInViewport({ timeout: 15_000 })
  const rows = section.locator('[data-slot="game-action-row"]')
  await expect(rows).toHaveCount(7)
  await expect(rows.nth(0)).toContainText('/release · Ask the lead')
  await expect(rows.nth(1)).toContainText('/board · MCP plane')
  await expect(section).toContainText('This project · 2 of 6')

  // A template opens the form first in the list; Create saves it on this machine, pinned.
  await dismissAppCards(orcaPage)
  await section.getByRole('button', { name: 'Deploy', exact: true }).click()
  const form = section.locator('[data-slot="game-action-form"]')
  await expect(form).toContainText('/deploy')
  if (CAPTURE_EVIDENCE) {
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await form.scrollIntoViewIfNeeded()
      const overflow = await section.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `the form overflows at ${width}`).toBeLessThanOrEqual(0)
      for (const theme of ['light', 'dark'] as const) {
        await applySettings(orcaPage, { theme })
        await orcaPage.screenshot({ path: testInfo.outputPath(`form-en-${width}-${theme}.png`) })
      }
    }
    await setWindowWidth(electronApp, orcaPage, 1440)
  }
  await dismissAppCards(orcaPage)
  await form.getByRole('button', { name: 'Create action' }).click()
  await expect(rows.nth(0)).toContainText('Deploy')
  await expect(rows.nth(0)).toContainText('This machine')
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (id) =>
          window
            .__store!.getState()
            .settings?.orchestratorGameProjects?.[id]?.actions?.map((one) => [
              one.label,
              one.pin === true
            ]),
        repo!.id
      )
    )
    .toEqual([
      ['Deploy', true],
      ['Release', true],
      ['Board', false]
    ])

  // Orca's Wave turns off on this machine; Stop has no switch.
  await dismissAppCards(orcaPage)
  await section.getByRole('switch', { name: 'Turn on Wave' }).click()
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (id) => window.__store!.getState().settings?.orchestratorGameProjects?.[id]?.orcaActions,
        repo!.id
      )
    )
    .toEqual({ wave: { enabled: false } })
  await expect(section.getByRole('switch', { name: 'Turn on Stop' })).toHaveCount(0)

  for (const language of ['en', 'es'] as const) {
    await applySettings(orcaPage, { uiLanguage: language })
    await expect(section).toContainText(language === 'en' ? 'From Orca' : 'De Orca')
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      const overflow = await section.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `Actions overflows at ${width}px ${language}`).toBeLessThanOrEqual(0)
      if (CAPTURE_EVIDENCE) {
        await section.scrollIntoViewIfNeeded()
        for (const theme of ['light', 'dark'] as const) {
          await applySettings(orcaPage, { theme })
          await orcaPage.screenshot({
            path: testInfo.outputPath(`actions-${language}-${width}-${theme}.png`)
          })
        }
      }
    }
  }

  // The same page's Scene listbox opens at its control; the trigger is read once it is in view (ORCA-1092 row 28).
  await applySettings(orcaPage, { uiLanguage: 'en' })
  const scene = orcaPage.getByRole('combobox', { name: /^Scene/ })
  for (const theme of CAPTURE_EVIDENCE ? (['light', 'dark'] as const) : (['light'] as const)) {
    await applySettings(orcaPage, { theme })
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await dismissAppCards(orcaPage)
      await scene.scrollIntoViewIfNeeded()
      const control = await scene.boundingBox()
      await scene.click()
      const list = orcaPage.locator('[role="listbox"]')
      await expect(list).toBeVisible()
      const box = await list.boundingBox()
      const gap =
        box && control
          ? Math.max(box.y - (control.y + control.height), control.y - (box.y + box.height))
          : Infinity
      const overlaps =
        box && control && box.x < control.x + control.width && control.x < box.x + box.width
      expect(gap, `Scene listbox gap at ${width} ${theme}`).toBeLessThanOrEqual(12)
      expect(overlaps, `Scene listbox under its control at ${width} ${theme}`).toBe(true)
      testInfo.annotations.push({
        type: 'scene',
        description: `${width} ${theme}: gap ${Math.round(gap)} px`
      })
      if (CAPTURE_EVIDENCE) {
        await orcaPage.screenshot({ path: testInfo.outputPath(`scene-${width}-${theme}.png`) })
      }
      await orcaPage.keyboard.press('Escape')
      await expect(list).toBeHidden()
    }
  }
})
