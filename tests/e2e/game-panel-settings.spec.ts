/**
 * Invariant: the panel gear's two Settings targets land on their section, the project's game
 * section and Agents > Panel, and both render at every width in both themes and languages.
 * Needs E2E: the scroll to a section id happens in the real Settings page after navigation.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const
const LANGUAGES = ['en', 'es'] as const

type SavedPanels = { global: string | undefined; project: string | undefined }

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

/** The gear's two calls: the fixture has no team model, so the real gear is in team-panel-shell. */
async function openTarget(page: Page, repoId: string | null): Promise<string> {
  return page.evaluate((id) => {
    const store = window.__store!.getState()
    const sectionId = id ? `repo-${id}-game` : 'agents-game-panel'
    store.openSettingsTarget(
      id ? { pane: 'repo', repoId: id, sectionId } : { pane: 'agents', repoId: null, sectionId }
    )
    store.openSettingsPage()
    return sectionId
  }, repoId)
}

async function expectSectionInView(page: Page, sectionId: string): Promise<void> {
  const section = page.locator(`[id="${sectionId}"]`)
  await expect(section).toBeVisible({ timeout: 15_000 })
  await expect(section).toBeInViewport({ timeout: 15_000 })
}

test('the panel gear opens the project game section and Agents > Panel', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(600_000)
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the fixture seeds a repo').not.toBeNull()

  for (const language of LANGUAGES) {
    await applySettings(orcaPage, { uiLanguage: language })
    for (const theme of THEMES) {
      await applySettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        for (const [name, target] of [
          ['project', repoId],
          ['global', null]
        ] as const) {
          const sectionId = await openTarget(orcaPage, target)
          await expectSectionInView(orcaPage, sectionId)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${name}-${language}-${theme}-${width}.png`),
            // Why: Settings fades in, and a shot taken mid-fade reads as low contrast.
            animations: 'disabled'
          })
          await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
        }
      }
    }
  }
})

test('panel rows save to their layer and the Advisor row follows the project host', async ({
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? '')
  expect(repoId, 'the fixture seeds a repo').not.toBe('')
  const viewBefore = await orcaPage.evaluate(() => window.__store!.getState().activeView)
  const press = (section: string, group: string, label: string): Promise<void> =>
    orcaPage
      .locator(`[id="${section}"] [aria-label="${group}"] button`)
      .filter({ hasText: new RegExp(`^${label}$`) })
      .click()
  const savedPanel = (): Promise<SavedPanels> =>
    orcaPage.evaluate(async (id) => {
      const saved = (await window.api.settings.get()) as {
        orchestratorGame?: { panel?: { look?: string } }
        orchestratorGameProjects?: Record<string, { panel?: { look?: string } }>
      }
      return {
        global: saved.orchestratorGame?.panel?.look,
        project: saved.orchestratorGameProjects?.[id]?.panel?.look
      }
    }, repoId)

  const globalSection = await openTarget(orcaPage, null)
  await expectSectionInView(orcaPage, globalSection)
  await press(globalSection, 'Panel look', 'Plain')
  await expect.poll(savedPanel).toMatchObject({ global: 'plain' })
  await expect(orcaPage.locator(`[id="${globalSection}"] [aria-label="Scene style"]`)).toHaveCount(
    0
  )
  await press(globalSection, 'Panel look', 'Game')
  await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeView))
    .toBe(viewBefore)

  const projectSection = await openTarget(orcaPage, repoId)
  await expectSectionInView(orcaPage, projectSection)
  await press(projectSection, 'Panel look', 'Display')
  await expect.poll(savedPanel).toMatchObject({ project: 'display' })
  await press(projectSection, 'Panel look', 'Inherit')
  await expect.poll(async () => (await savedPanel()).project).toBeUndefined()

  // Why: the fixture host has no Advisor plugin, and an SSH host cannot be asked.
  const advisor = orcaPage.locator(`[id="${projectSection}"] [aria-label="Advisor"]`)
  await expect(advisor).toHaveCount(0)
  await orcaPage.evaluate((id) => {
    window.__store!.setState((state) => ({
      repos: state.repos.map((repo) =>
        repo.id === id
          ? { ...repo, connectionId: 'e2e-ssh', executionHostId: 'ssh:e2e-ssh' as const }
          : repo
      )
    }))
  }, repoId)
  await expect(advisor).toBeVisible()
  await advisor.scrollIntoViewIfNeeded()
  await orcaPage.screenshot({
    path: testInfo.outputPath('project-with-advisor-row.png'),
    animations: 'disabled'
  })
})

test('a saved soft shows as Pixel in both rows, stays on disk, and is not offered', async ({
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? '')
  expect(repoId, 'the fixture seeds a repo').not.toBe('')
  const save = (global: string, project: string): Promise<void> =>
    orcaPage.evaluate(
      async ([id, globalStyle, projectStyle]) => {
        const settings = await window.api.settings.set({
          orchestratorGame: { panel: { style: globalStyle } },
          orchestratorGameProjects: { [id]: { panel: { style: projectStyle } } }
        } as Parameters<typeof window.api.settings.set>[0])
        window.__store?.setState({ settings })
      },
      [repoId, global, project]
    )
  const styles = (section: string) =>
    orcaPage.locator(`[id="${section}"] [aria-label="Scene style"] [role="radio"]`)
  const checked = (section: string) =>
    orcaPage.locator(
      `[id="${section}"] [aria-label="Scene style"] [role="radio"][aria-checked="true"]`
    )

  await save('soft', 'soft')
  const globalSection = await openTarget(orcaPage, null)
  await expectSectionInView(orcaPage, globalSection)
  await expect(styles(globalSection)).toHaveText(['Figures', 'Office', 'Pixel'])
  await expect(checked(globalSection)).toHaveText('Pixel')
  await orcaPage.screenshot({
    path: testInfo.outputPath('saved-soft-global.png'),
    animations: 'disabled'
  })
  await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())

  // Why over Figures: a dropped soft would show the layer below, and only Pixel proves it resolved.
  await save('figures', 'soft')
  const projectSection = await openTarget(orcaPage, repoId)
  await expectSectionInView(orcaPage, projectSection)
  await expect(styles(projectSection)).toHaveText(['Inherit', 'Figures', 'Office', 'Pixel'])
  await expect(checked(projectSection)).toHaveText('Pixel')
  await expect(orcaPage.locator(`[id="${projectSection}"]`)).toContainText('Pixel · this machine')
  await checked(projectSection).scrollIntoViewIfNeeded()
  await orcaPage.screenshot({
    path: testInfo.outputPath('saved-soft-project.png'),
    animations: 'disabled'
  })

  const onDisk = await orcaPage.evaluate(async (id) => {
    const saved = (await window.api.settings.get()) as {
      orchestratorGameProjects?: Record<string, { panel?: { style?: string } }>
    }
    return saved.orchestratorGameProjects?.[id]?.panel?.style
  }, repoId)
  expect(onDisk).toBe('soft')
})

test('the panel preview draws the chosen style, and the terminal band stays its own group', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(600_000)
  await waitForSessionReady(orcaPage)
  await applySettings(orcaPage, { uiLanguage: 'en' })
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? '')
  expect(repoId, 'the fixture seeds a repo').not.toBe('')
  const projectSection = `repo-${repoId}-game`
  const preview = (section: string) =>
    orcaPage.locator(`[id="${section}"] [data-slot="game-panel-style-preview"]`)

  for (const style of ['office', 'figures', 'pixel'] as const) {
    const label = { office: 'Office', figures: 'Figures', pixel: 'Pixel' }[style]
    const globalSection = await openTarget(orcaPage, null)
    await expectSectionInView(orcaPage, globalSection)
    await orcaPage
      .locator(`[id="${globalSection}"] [aria-label="Scene style"] button`)
      .filter({ hasText: new RegExp(`^${label}$`) })
      .click()
    await expect(preview(globalSection)).toHaveAttribute('data-style', style)
    // Why the canvas: the stage paints only once the style's art has loaded.
    await expect(preview(globalSection).locator('canvas')).toBeVisible({ timeout: 15_000 })
    const band = orcaPage.locator('[role="group"][aria-label="Terminal band"]')
    await expect(band.getByRole('heading', { name: 'Terminal band' })).toBeVisible()
    await expect(band.locator('[aria-label="Scene style"]')).toHaveCount(0)
    for (const theme of THEMES) {
      await applySettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        for (const [name, target] of [
          ['panel', orcaPage.locator(`[id="${globalSection}"]`)],
          ['band', band]
        ] as const) {
          await target.scrollIntoViewIfNeeded()
          await target.screenshot({
            path: testInfo.outputPath(`${style}-${name}-${theme}-${width}.png`),
            animations: 'disabled'
          })
        }
      }
    }
    await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())

    await openTarget(orcaPage, repoId)
    await expectSectionInView(orcaPage, projectSection)
    await expect(preview(projectSection)).toHaveAttribute('data-style', style)
    await expect(
      orcaPage.locator(`[id="${projectSection}"] [role="group"][aria-label="Terminal band"]`)
    ).toBeVisible()
    for (const theme of THEMES) {
      await applySettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        // Why the window: the project section outgrows it, and an element shot of it paints blank.
        for (const [name, target] of [
          ['project-panel', preview(projectSection)],
          [
            'project-band',
            orcaPage.locator(`[id="${projectSection}"] [role="group"][aria-label="Terminal band"]`)
          ]
        ] as const) {
          await target.evaluate((node) => node.scrollIntoView({ block: 'center' }))
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${style}-${name}-${theme}-${width}.png`),
            animations: 'disabled'
          })
        }
      }
    }
    await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
  }
})

test('the terminal band is off by default, and its switch shows what it draws', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  test.setTimeout(600_000)
  await waitForSessionReady(orcaPage)
  await applySettings(orcaPage, { uiLanguage: 'en' })
  const band = orcaPage.locator('[role="group"][aria-label="Terminal band"]')
  const drawn = [
    band.locator('[data-slot="game-scene-preview"]'),
    band.locator('[aria-label="Render"]'),
    band.locator('[aria-label="Time zone"]'),
    band.locator('[aria-label="Teammate HUD"]')
  ]

  await openTarget(orcaPage, null)
  await expect(band).toBeVisible({ timeout: 15_000 })
  for (const state of ['off', 'on'] as const) {
    if (state === 'on') {
      await band.getByRole('switch', { name: 'Show the band' }).click()
      await expect
        .poll(() =>
          orcaPage.evaluate(
            async () =>
              ((await window.api.settings.get()) as { orchestratorGame?: { band?: boolean } })
                .orchestratorGame?.band
          )
        )
        .toBe(true)
    }
    await expect(band.getByRole('switch', { name: 'Show the band' })).toHaveAttribute(
      'aria-checked',
      state === 'on' ? 'true' : 'false'
    )
    for (const row of drawn) {
      await expect(row).toHaveCount(state === 'on' ? 1 : 0)
    }
    for (const theme of THEMES) {
      await applySettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await band.evaluate((node) => node.scrollIntoView({ block: 'center' }))
        await orcaPage.screenshot({
          path: testInfo.outputPath(`band-${state}-${theme}-${width}.png`),
          animations: 'disabled'
        })
      }
    }
  }
  await orcaPage.evaluate(() => window.__store!.getState().closeSettingsPage())
})
