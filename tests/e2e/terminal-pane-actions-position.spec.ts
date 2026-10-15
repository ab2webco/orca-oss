/**
 * Invariant: the floating actions of an untitled terminal pane sit where
 * terminalPaneActionsPosition says, in every split pane, and default to the
 * bottom-right corner (ORCA-575).
 * Needs E2E: placement is CSS (transform + margins) over measured pane rects, so
 * only a real layout proves the strip lands inside the right corner of each pane.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { splitActiveTerminalPane, waitForPaneCount } from './helpers/terminal'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

const WIDTHS = [1440, 768, 390, 320]
const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
] as const
type Position = (typeof POSITIONS)[number]

// Why: the strip is 24px tall and padded 2px from the pane edge; anything within
// one strip height of the expected edge is "in that corner".
const EDGE_TOLERANCE_PX = 26

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

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function setPosition(page: Page, position: Position): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ terminalPaneActionsPosition: next })
    window.__store?.setState({ settings })
  }, position)
}

type Placement = { pane: DOMRectJSON; actions: DOMRectJSON }
type DOMRectJSON = { left: number; right: number; top: number; bottom: number }

/** Pairs each chromeless strip's actions with the pane whose left edge it shares. */
async function readPlacements(page: Page): Promise<Placement[]> {
  return page.evaluate(() => {
    const toJson = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    })
    const panes = Array.from(document.querySelectorAll<HTMLElement>('.pane[data-leaf-id]'))
      .map((pane) => pane.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    const bars = Array.from(
      document.querySelectorAll<HTMLElement>('.pane-title-bar[data-chromeless]')
    ).filter((bar) => bar.getBoundingClientRect().width > 0)
    return bars.flatMap((bar) => {
      const barRect = bar.getBoundingClientRect()
      const pane = panes.find((rect) => Math.abs(rect.left - barRect.left) < 1)
      const actions = bar.querySelector<HTMLElement>('.pane-title-actions')
      return pane && actions
        ? [{ pane: toJson(pane), actions: toJson(actions.getBoundingClientRect()) }]
        : []
    })
  })
}

function placementMatches({ pane, actions }: Placement, position: Position): boolean {
  const [edge, align] = position.split('-')
  const inside =
    actions.left >= pane.left - 1 &&
    actions.right <= pane.right + 1 &&
    actions.top >= pane.top - 1 &&
    actions.bottom <= pane.bottom + 1
  const onEdge =
    edge === 'top'
      ? actions.top - pane.top < EDGE_TOLERANCE_PX
      : pane.bottom - actions.bottom < EDGE_TOLERANCE_PX
  const aligned =
    align === 'left'
      ? actions.left - pane.left < EDGE_TOLERANCE_PX
      : align === 'right'
        ? pane.right - actions.right < EDGE_TOLERANCE_PX
        : Math.abs((actions.left + actions.right) / 2 - (pane.left + pane.right) / 2) < 2
  return inside && onEdge && aligned
}

test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('untitled pane actions follow the configured position in every split pane', async ({
    electronApp,
    orcaPage
  }, testInfo: TestInfo) => {
    await setWindowWidth(electronApp, orcaPage, 1440)
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)

    // Default: a fresh profile never wrote the key, so the strip resolves to bottom-right.
    await expect
      .poll(async () => {
        const placements = await readPlacements(orcaPage)
        return placements.length > 0 && placements.every((p) => placementMatches(p, 'bottom-right'))
      })
      .toBe(true)

    for (const position of POSITIONS) {
      await setPosition(orcaPage, position)
      await expect
        .poll(
          async () => {
            const placements = await readPlacements(orcaPage)
            return placements.length > 0 && placements.every((p) => placementMatches(p, position))
          },
          { message: `pane actions are not at ${position}` }
        )
        .toBe(true)
      await orcaPage.screenshot({ path: testInfo.outputPath(`position-${position}.png`) })
    }

    await setPosition(orcaPage, 'bottom-right')
    for (const width of WIDTHS) {
      // Why: below tablet width both sidebars cover the whole terminal, as a phone user would close them.
      await orcaPage.evaluate((narrow) => {
        const state = window.__store!.getState()
        state.setSidebarOpen(!narrow)
        state.setRightSidebarOpen(!narrow)
      }, width < 768)
      await setWindowWidth(electronApp, orcaPage, width)
      await expect
        .poll(async () => {
          const placements = await readPlacements(orcaPage)
          return (
            placements.length > 0 && placements.every((p) => placementMatches(p, 'bottom-right'))
          )
        })
        .toBe(true)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({ path: testInfo.outputPath(`terminal-${width}-${theme}.png`) })
      }
    }
  })

  test('Settings > Terminal changes the pane actions position', async ({
    electronApp,
    orcaPage
  }, testInfo: TestInfo) => {
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsTarget({ pane: 'appearance', repoId: null })
      state.openSettingsPage()
    })
    // Why: the row lives in Appearance's collapsed Terminal section; search is how users reach it.
    await orcaPage.getByPlaceholder('Search settings').fill('Pane Actions Position')
    const edge = orcaPage.getByRole('radiogroup', { name: 'Pane actions edge' })
    const align = orcaPage.getByRole('radiogroup', { name: 'Pane actions alignment' })
    await edge.scrollIntoViewIfNeeded()
    await expect(edge.getByRole('radio', { name: 'Bottom' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(align.getByRole('radio', { name: 'Right' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await edge.scrollIntoViewIfNeeded()
      // Why: the row wraps its stacked controls under the label instead of overflowing its card.
      const rowOverflow = await edge.evaluate((element) => {
        const row = element.closest<HTMLElement>('.flex-wrap')
        return row ? row.scrollWidth - row.clientWidth : null
      })
      expect(rowOverflow, `pane actions row overflows at ${width}px`).toBe(0)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({ path: testInfo.outputPath(`settings-${width}-${theme}.png`) })
      }
    }

    await setWindowWidth(electronApp, orcaPage, 1440)
    await edge.getByRole('radio', { name: 'Top' }).click()
    await align.getByRole('radio', { name: 'Center' }).click()
    await expect
      .poll(async () =>
        orcaPage.evaluate(async () => (await window.api.settings.get()).terminalPaneActionsPosition)
      )
      .toBe('top-center')
  })
})
