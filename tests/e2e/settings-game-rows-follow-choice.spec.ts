/**
 * Invariant: each Agents Teams game row shows only while the current choice uses it, search offers
 * only shown rows, a project row shows the applied value with Reset only while this machine
 * overrides it, and a choice that hides rows above the pressed control does not move it (ORCA-1112).
 * Needs E2E: the control's position and the scroll offset only exist with real layout.
 */

import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

// Why: the width and theme captures outrun the CI budget; ORCA_CAPTURE_EVIDENCE=1 saves them locally.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const WIDTHS = [1440, 768, 390, 320] as const

const EVERYTHING = {
  mode: 'on',
  band: true,
  render: 'hd',
  panel: { look: 'game', style: 'figures', diorama: true }
} as const

type Settings = Parameters<typeof window.api.settings.set>[0]

async function openTarget(page: Page, repoId: string | null): Promise<Locator> {
  const sectionId = await page.evaluate((id) => {
    const store = window.__store!.getState()
    const section = id ? `repo-${id}-game` : 'agents-game-panel'
    store.openSettingsTarget(
      id
        ? { pane: 'repo', repoId: id, sectionId: section }
        : { pane: 'agents', repoId: null, sectionId: section }
    )
    store.openSettingsPage()
    return section
  }, repoId)
  const section = page.locator(`[id="${sectionId}"]`)
  await expect(section).toBeVisible({ timeout: 15_000 })
  return section
}

/** The game rows drawn anywhere on the open Settings page, in order. */
const shownRows = (page: Page): Promise<string[]> =>
  page
    .locator('[data-game-row]')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.gameRow ?? ''))

/** Presses `control` and returns how far it moved on screen once the rows settle. */
async function movedBy(page: Page, control: Locator): Promise<number> {
  await control.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  const before = (await control.boundingBox())!.y
  await control.click()
  // Why two frames: the store write, React's commit and the scroll adjustment all land by then.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  return (await control.boundingBox())!.y - before
}

/** The rows a scroll can absorb: the control must sit low enough for the page to scroll back. */
async function scrollTopOf(control: Locator): Promise<number> {
  return control.evaluate((node) => {
    for (let one = node.parentElement; one; one = one.parentElement) {
      const { overflowY } = getComputedStyle(one)
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return one.scrollTop
      }
    }
    return -1
  })
}

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function capture(
  app: ElectronApplication,
  page: Page,
  section: Locator,
  name: string,
  testInfo: TestInfo
): Promise<void> {
  if (!CAPTURE_EVIDENCE) {
    return
  }
  for (const width of WIDTHS) {
    await setWindowWidth(app, page, width)
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(page, { theme })
      await section.evaluate((node) => node.scrollIntoView({ block: 'start' }))
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${width}-${theme}.png`),
        animations: 'disabled'
      })
    }
  }
  await setWindowWidth(app, page, 1440)
}

test('the global game rows follow the choices, search and the pressed control', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 300_000 : 120_000)
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
  await setWindowWidth(electronApp, orcaPage, 1440)
  await writeSettings(orcaPage, { orchestratorGame: EVERYTHING } as Settings)
  const section = await openTarget(orcaPage, null)

  await expect
    .poll(() => shownRows(orcaPage))
    .toEqual(expect.arrayContaining(['style', 'diorama', 'scene', 'timezone', 'band', 'render']))
  await capture(electronApp, orcaPage, section, 'global-everything', testInfo)

  await section.getByRole('radiogroup', { name: 'Panel look' }).getByText('Plain').click()
  await expect.poll(() => shownRows(orcaPage)).not.toContain('style')
  expect(await shownRows(orcaPage)).not.toContain('diorama')
  // Why still shown: in Plain only the drawn band reads the scene and the time zone.
  expect(await shownRows(orcaPage)).toEqual(expect.arrayContaining(['scene', 'timezone']))

  const band = orcaPage.locator('[role="switch"][aria-label="Show the band"]')
  await band.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  expect(
    await scrollTopOf(band),
    'the page must scroll for the check to mean anything'
  ).toBeGreaterThan(200)
  const offMoved = await movedBy(orcaPage, band)
  await expect.poll(() => shownRows(orcaPage)).not.toContain('scene')
  expect(await shownRows(orcaPage)).not.toContain('timezone')
  expect(await shownRows(orcaPage)).not.toContain('render')
  expect(Math.abs(offMoved), 'Show the band moved under the pointer').toBeLessThanOrEqual(1)
  const onMoved = await movedBy(orcaPage, band)
  await expect.poll(() => shownRows(orcaPage)).toContain('scene')
  expect(Math.abs(onMoved), 'Show the band moved under the pointer').toBeLessThanOrEqual(1)
  testInfo.annotations.push({ type: 'moved', description: `off ${offMoved}, on ${onMoved}` })

  const view = orcaPage.getByRole('combobox', { name: 'Default view' })
  await view.click()
  await orcaPage.getByRole('option', { name: 'Flat · light' }).click()
  await expect(orcaPage.locator('[data-game-group="band"]')).toHaveCount(0)
  await expect(orcaPage.locator('[aria-label="Render"]')).toHaveCount(0)
  await capture(electronApp, orcaPage, section, 'global-flat', testInfo)

  // Why the sidebar: a search opens the first matching pane, so an empty page alone proves nothing.
  const sidebar = orcaPage.getByRole('complementary')
  const agentsEntry = sidebar.getByRole('button', { name: 'Agents', exact: true })
  await orcaPage.evaluate(() => window.__store!.getState().setSettingsSearchQuery('render'))
  await expect(sidebar.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible()
  await expect(agentsEntry).toHaveCount(0)
  await writeSettings(orcaPage, { orchestratorGame: EVERYTHING } as Settings)
  await expect(agentsEntry).toBeVisible()
  await agentsEntry.click()
  await expect(orcaPage.locator('[aria-label="Render"]').first()).toBeVisible()
  await orcaPage.evaluate(() => window.__store!.getState().setSettingsSearchQuery(''))
})

test('a project row shows the applied value, and Reset by keyboard only while overridden', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 300_000 : 120_000)
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
  await setWindowWidth(electronApp, orcaPage, 1440)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? '')
  expect(repoId, 'the fixture seeds a repo').not.toBe('')
  await writeSettings(orcaPage, {
    orchestratorGame: { ...EVERYTHING, panel: { ...EVERYTHING.panel, look: 'plain' } },
    orchestratorGameProjects: {}
  } as Settings)
  const section = await openTarget(orcaPage, repoId)

  await expect(section.locator('[data-game-row="render"]')).toBeVisible()
  await expect(section.getByRole('radio', { name: 'Inherit', exact: true })).toHaveCount(0)
  await expect(section.locator('[data-slot="game-row-source"] button')).toHaveCount(0)
  const bandRow = section.locator('[data-game-row="band"]')
  await expect(bandRow.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')
  await expect(bandRow.locator('[data-slot="game-row-source"]')).toHaveText('On · global setting')
  await capture(electronApp, orcaPage, section, 'project-inherited', testInfo)

  const off = bandRow.getByRole('radio', { name: 'Off' })
  const moved = await movedBy(orcaPage, off)
  expect(Math.abs(moved), 'the band Off control moved under the pointer').toBeLessThanOrEqual(1)
  const reset = bandRow.locator('[data-slot="game-row-source"] button')
  await expect(reset).toHaveText('Reset to On (global setting)')
  await capture(electronApp, orcaPage, section, 'project-overridden', testInfo)

  await reset.focus()
  await orcaPage.keyboard.press('Enter')
  await expect
    .poll(() =>
      orcaPage.evaluate(
        async (id) =>
          (
            (await window.api.settings.get()) as {
              orchestratorGameProjects?: Record<string, unknown>
            }
          ).orchestratorGameProjects?.[id],
        repoId
      )
    )
    .toBeUndefined()
  await expect(section.locator('[data-slot="game-row-source"] button')).toHaveCount(0)
})

/**
 * The pane's own gap between two ordinary sections, and the gaps above, between and below the two
 * game sections. Why measured: display: contents on their wrapper once dropped two of the three.
 */
const sectionGapsOf = (panel: Locator) =>
  panel.evaluate((node) => {
    const teams = node.parentElement!.querySelector(':scope > section:not([id])')!
    const wrapper = node.parentElement!
    const before = wrapper.previousElementSibling!
    const box = (el: Element) => el.getBoundingClientRect()
    return {
      pane: box(before).top - box(before.previousElementSibling!).bottom,
      abovePanel: box(node).top - box(before).bottom,
      panelToTeams: box(teams).top - box(node).bottom,
      belowTeams: box(wrapper.nextElementSibling!).top - box(teams).bottom
    }
  })

const PANEL_ROWS = ['look', 'style', 'stylePreview', 'scene', 'prs', 'machines', 'timezone']
const RUNNING_ROWS = ['show', 'view', 'hud', 'rewards', 'openLinks', 'tracker']
const BAND_ROWS = ['band', 'bandPreview', 'render']

// Why these five: the views that drop rows (Off, Flat) and each scene style a pixel view draws.
const CHOICES = [
  { name: 'off', layer: { mode: 'off' }, rows: [...PANEL_ROWS, 'show', 'view'] },
  { name: 'flat', layer: { mode: 'flat' }, rows: ['look', 'prs', 'machines', ...RUNNING_ROWS] },
  {
    name: 'pixel',
    layer: { mode: 'on', band: true, panel: { look: 'game', style: 'pixel' } },
    rows: [...PANEL_ROWS, ...RUNNING_ROWS, ...BAND_ROWS]
  },
  {
    name: 'figures',
    layer: { mode: 'on', band: true, panel: { look: 'game', style: 'figures', diorama: true } },
    rows: [
      ...PANEL_ROWS.slice(0, 3),
      'diorama',
      ...PANEL_ROWS.slice(3),
      ...RUNNING_ROWS,
      ...BAND_ROWS
    ]
  },
  {
    name: 'office',
    layer: { mode: 'on', band: true, panel: { look: 'game', style: 'office' } },
    rows: [...PANEL_ROWS, ...RUNNING_ROWS, ...BAND_ROWS]
  }
] as const

test('the Agents page draws each choice with only its rows: Off, Flat, Pixel, Figures, Office', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 900_000 : 120_000)
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
  await setWindowWidth(electronApp, orcaPage, 1440)
  const panel = await openTarget(orcaPage, null)
  const teams = orcaPage.getByRole('heading', { name: 'Agent Teams game' }).first()

  for (const choice of CHOICES) {
    await writeSettings(orcaPage, { orchestratorGame: choice.layer } as Settings)
    await expect.poll(() => shownRows(orcaPage), choice.name).toEqual([...choice.rows])
    const gaps = await sectionGapsOf(panel)
    expect(gaps.pane, choice.name).toBeGreaterThan(0)
    for (const gap of ['abovePanel', 'panelToTeams', 'belowTeams'] as const) {
      expect(gaps[gap], `${choice.name} ${gap}`).toBeCloseTo(gaps.pane, 0)
    }
    if (!CAPTURE_EVIDENCE) {
      continue
    }
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of ['dark', 'light'] as const) {
        await writeSettings(orcaPage, { theme })
        for (const [part, top] of [
          ['panel', panel],
          ['teams', teams]
        ] as const) {
          await top.evaluate((node) => node.scrollIntoView({ block: 'start' }))
          await orcaPage.screenshot({
            path: testInfo.outputPath(`agents-${choice.name}-${width}-${theme}-${part}.png`),
            animations: 'disabled'
          })
        }
      }
    }
    await setWindowWidth(electronApp, orcaPage, 1440)
  }
})
