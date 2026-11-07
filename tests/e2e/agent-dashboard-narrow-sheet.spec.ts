/**
 * Invariant: the Agents dashboard sheet is usable at phone widths — it covers the sidebar instead of
 * squeezing beside it, every board column can be reached, nothing in its header or the tab strip
 * overlaps, closing the left sidebar leaves it open, and 1440 and 768 keep it beside the sidebar
 * (ORCA-1126).
 * Needs E2E: the sheet's width comes from the real window, sidebar and portal layout.
 * ORCA_E2E_CAPTURE=1 also saves Grid, Dashboard and Agent Map at every width and theme.
 */

import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { expectPlaceholdersFit } from './helpers/placeholder-fit'
import {
  splitActiveTerminalPane,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'

const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const WIDTHS = [1440, 768, 390, 320] as const
const NARROW_WIDTHS = new Set<number>([390, 320])
const DEFAULT_SIDEBAR_WIDTH = 280
const SEEDED: { state: 'blocked' | 'working' | 'done'; title: string }[] = [
  { state: 'blocked', title: 'Needs a merge answer' },
  { state: 'working', title: 'Running the narrow sheet spec' },
  { state: 'done', title: 'Opened the PR' }
]

type Box = { left: number; right: number; top: number; bottom: number }

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
  await settle(page)
}

/** Why: the sheet slides in over 300 ms; a measure or capture inside it reads a half-open sheet. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function applySettings(page: Page, updates: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set(next)
    window.__store?.setState({ settings })
  }, updates)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await applySettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function box(locator: Locator): Promise<Box> {
  const rect = await locator.boundingBox()
  if (!rect) {
    throw new Error('element has no layout box')
  }
  return { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height }
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.right - 0.5 &&
    b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 &&
    b.top < a.bottom - 0.5
  )
}

/** Why hit-testing: a column scrolled into a clipped box still reports a rect. */
async function expectPainted(page: Page, target: Locator, label: string): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  await settle(page)
  const hit = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const x = rect.left + Math.min(24, rect.width / 2)
    const y = rect.top + Math.min(12, rect.height / 2)
    const top = document.elementFromPoint(x, y)
    return { inside: Boolean(top && element.contains(top)), x, y, width: window.innerWidth }
  })
  expect.soft(hit.inside, `${label}: not on top at ${hit.x},${hit.y}`).toBe(true)
  expect.soft(hit.x, `${label}: off the right edge`).toBeLessThan(hit.width)
}

type Copy = {
  search: string
  filter: RegExp
  board: string
  map: string
  command: string
  rightToggle: string
}

const COPY: Record<'en' | 'es', Copy> = {
  en: {
    search: 'Search agents',
    filter: /^Filter/,
    board: 'Dashboard',
    map: 'Agent Map',
    command: 'Add quick command',
    rightToggle: 'Toggle right sidebar'
  },
  es: {
    search: 'Buscar agentes',
    filter: /^Filtrar/,
    board: 'Panel',
    map: 'Mapa de agentes',
    command: 'Agregar comando rápido',
    rightToggle: 'Alternar barra lateral derecha'
  }
}

/** Lines an element's text spans. Why text nodes: a flex item is one block box whatever it wraps. */
async function lineCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const tops: number[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) {
        continue
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      tops.push(...[...range.getClientRects()].map((rect) => rect.top))
    }
    tops.sort((a, b) => a - b)
    return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 4).length
  })
}

/** The board's own header, toolbar and grid controls, shared by the sheet and the pop-out. */
async function expectBoardLayout(root: Locator, label: string, copy: Copy): Promise<void> {
  const rootBox = await box(root)
  expect.soft(await lineCount(root.getByText(/^\d+ total$/)), `"N total" wraps ${label}`).toBe(1)
  const search = root.getByRole('textbox', { name: copy.search })
  const filter = root.getByRole('button', { name: copy.filter })
  expect
    .soft(overlaps(await box(search), await box(filter)), `Filter over search ${label}`)
    .toBe(false)
  expect
    .soft((await box(filter)).right, `Filter past the edge ${label}`)
    .toBeLessThanOrEqual(rootBox.right + 0.5)
  await expectPlaceholdersFit(root, label)
  const pageSizeTops = await root
    .locator('[data-agent-grid-controls] button[aria-label]')
    .evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().top))
    )
  expect
    .soft(new Set(pageSizeTops).size, `page sizes split across rows ${label}`)
    .toBeLessThanOrEqual(1)
  const controls = root.locator('[data-agent-grid-controls] button')
  for (const control of await controls.all()) {
    const name = (await control.innerText()).replace(/\s+/g, ' ')
    expect
      .soft((await box(control)).right, `grid control ${name} cut ${label}`)
      .toBeLessThanOrEqual(rootBox.right + 0.5)
    expect.soft(await lineCount(control), `grid control ${name} wraps ${label}`).toBe(1)
  }
}

async function expectSheetLayout(sheet: Locator, width: number, copy: Copy): Promise<void> {
  const rect = await box(sheet)
  const expectedLeft = NARROW_WIDTHS.has(width) ? 0 : DEFAULT_SIDEBAR_WIDTH
  expect.soft(Math.round(rect.left), `sheet left at ${width}`).toBe(expectedLeft)
  expect.soft(Math.round(rect.right), `sheet right at ${width}`).toBe(width)
  await expectBoardLayout(sheet, `at ${width}`, copy)
  // The header's actions share the title's row; only the view toggle drops below.
  const title = await box(sheet.getByRole('heading', { level: 1 }))
  const close = await box(sheet.getByRole('button', { name: 'Close dashboard' }))
  expect
    .soft(
      Math.abs((close.top + close.bottom) / 2 - (title.top + title.bottom) / 2),
      `close off the title row at ${width}`
    )
    .toBeLessThan(8)
}

/** Why 390 must keep the button: there the strip still has room for its icon, so hiding it is a loss. */
async function expectTabStripClear(page: Page, width: number, copy: Copy): Promise<void> {
  const command = page.getByRole('button', { name: copy.command }).first()
  const toggle = page.getByRole('button', { name: copy.rightToggle }).first()
  await expect(toggle).toBeVisible()
  if (width >= 390) {
    await expect(command).toBeVisible()
  }
  if (await command.isVisible()) {
    expect
      .soft(overlaps(await box(command), await box(toggle)), `Command over toggle at ${width}`)
      .toBe(false)
  }
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (CAPTURE) {
    await settle(page)
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
  }
}

test('the Agents sheet covers the sidebar at phone widths and outlives a sidebar close', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(CAPTURE ? 360_000 : 180_000)
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await splitActiveTerminalPane(orcaPage, 'vertical')
  await splitActiveTerminalPane(orcaPage, 'horizontal')
  await waitForPaneCount(orcaPage, SEEDED.length)
  const snapshot = await waitForPaneIdentitySnapshot(orcaPage, SEEDED.length)
  const paneKeys = snapshot.panes.map((pane) => `${snapshot.tabId}:${pane.leafId}`)

  await orcaPage.evaluate(
    async ({ paneKeys, seeded }) => {
      const store = window.__store!
      const settings = await window.api.settings.set({ experimentalAgentDashboardPopout: true })
      store.setState({ settings })
      const now = Date.now()
      seeded.forEach(({ state, title }, index) => {
        store
          .getState()
          .setAgentStatus(
            paneKeys[index],
            { state, prompt: title, agentType: 'claude', lastAssistantMessage: title },
            title,
            { updatedAt: now, stateStartedAt: now - 60_000 }
          )
      })
      store.getState().setSidebarOpen(true)
      store.getState().setRightSidebarOpen(false)
    },
    { paneKeys, seeded: SEEDED }
  )

  const en = COPY.en
  const sheet = orcaPage.locator('[data-agent-dashboard-sheet]')
  await setWindowWidth(electronApp, orcaPage, 390)
  await orcaPage.evaluate(() => window.__store!.getState().setAgentDashboardDrawerOpen(true))
  await sheet.waitFor({ state: 'visible' })
  await settle(orcaPage)
  await expectSheetLayout(sheet, 390, en)
  // Why dispatchEvent: the toggle's own reachability is the layout asserted above.
  await sheet.getByRole('button', { name: en.board, exact: true }).dispatchEvent('click')
  await settle(orcaPage)
  await expectTabStripClear(orcaPage, 390, en)
  const columns = sheet.locator('[data-agent-board-column]')
  await expect(columns).toHaveCount(3)
  await expectPainted(orcaPage, columns.last(), 'last column at 390')

  await orcaPage.getByRole('button', { name: 'Toggle sidebar' }).first().click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().sidebarOpen))
    .toBe(false)
  await settle(orcaPage)
  await expect.soft(sheet, 'the sheet closed with the sidebar').toBeVisible()
  await orcaPage.evaluate(() => {
    window.__store!.getState().setSidebarOpen(true)
    window.__store!.getState().setAgentDashboardDrawerOpen(true)
  })
  await sheet.waitFor({ state: 'visible' })
  await settle(orcaPage)

  const languages = CAPTURE ? (['en', 'es'] as const) : (['en'] as const)
  const themes = CAPTURE ? (['light', 'dark'] as const) : (['light'] as const)
  for (const language of languages) {
    const copy = COPY[language]
    await applySettings(orcaPage, { uiLanguage: language })
    // Why reopen: the board reads its copy at render, so only a remount shows the new language.
    await orcaPage.evaluate(() => window.__store!.getState().setAgentDashboardDrawerOpen(false))
    await sheet.waitFor({ state: 'hidden' })
    await orcaPage.evaluate(() => window.__store!.getState().setAgentDashboardDrawerOpen(true))
    await expect(sheet.getByRole('button', { name: copy.board, exact: true })).toBeVisible()
    for (const theme of themes) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        for (const [view, name] of [
          ['grid', 'Grid'],
          ['dashboard', copy.board]
        ] as const) {
          await sheet.getByRole('button', { name, exact: true }).dispatchEvent('click')
          await settle(orcaPage)
          await expectSheetLayout(sheet, width, copy)
          await expectTabStripClear(orcaPage, width, copy)
          if (view === 'dashboard') {
            await expectPainted(orcaPage, columns.last(), `last column at ${width}`)
            await columns.first().scrollIntoViewIfNeeded()
          }
          await capture(orcaPage, testInfo, `${view}-${width}-${theme}-${language}`)
        }
      }
    }
  }

  if (!CAPTURE) {
    return
  }
  // The in-window Agent Map is the pop-out window; check and capture it at the same widths.
  const copy = COPY[languages.at(-1)!]
  const popoutPromise = electronApp.waitForEvent('window')
  await sheet.getByRole('button', { name: copy.map, exact: true }).click()
  const popout = await popoutPromise
  await popout.waitForLoadState('domcontentloaded')
  await expect(popout.getByRole('button', { name: copy.map, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        const target = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('popout.html')
        )
        target?.setMinimumSize(320, 400)
        target?.setSize(size, 900)
      }, width)
      await expect.poll(async () => popout.evaluate(() => window.innerWidth)).toBe(width)
      await settle(popout)
      await expectBoardLayout(popout.locator('body'), `in the map at ${width}`, copy)
      await capture(popout, testInfo, `map-${width}-${theme}-es`)
    }
  }
})
