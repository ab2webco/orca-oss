/**
 * ORCA-1244: the left sidebar must meet the center panel with no strip between them. The left
 * column also holds the titlebar header, and when that header's controls were wider than the
 * sidebar the column grew past the sidebar's own width, leaving an empty strip. Needs E2E: only a
 * real layout can tell where the column ends.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'

// Why: MIN_WIDTH and MAX_WIDTH in components/sidebar/index.tsx, and the store default.
const NARROWEST = 220
const WIDEST = 500
const DEFAULT_WIDTH = 280

type Seam = { sidebarRight: number; columnRight: number; centerLeft: number }

/** Where the sidebar ends, where its layout column ends, and where the center panel starts. */
async function readSeam(page: Page): Promise<Seam> {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[data-worktree-sidebar-root]')
    if (!sidebar) {
      throw new Error('sidebar root not found')
    }
    // Why walk: in workspace view the sidebar sits in a column under the titlebar header; elsewhere it is the column.
    let column: HTMLElement = sidebar
    while (column.parentElement && !column.parentElement.classList.contains('flex-row')) {
      column = column.parentElement
    }
    const center = column.nextElementSibling
    if (!center) {
      throw new Error('center panel not found beside the sidebar column')
    }
    return {
      sidebarRight: Math.round(sidebar.getBoundingClientRect().right),
      columnRight: Math.round(column.getBoundingClientRect().right),
      centerLeft: Math.round(center.getBoundingClientRect().left)
    }
  })
}

async function expectNoStrip(page: Page, label: string): Promise<Seam> {
  await expect
    .poll(
      async () => {
        const seam = await readSeam(page)
        return {
          column: seam.columnRight - seam.sidebarRight,
          center: seam.centerLeft - seam.sidebarRight
        }
      },
      { message: `${label}: gap between the sidebar and the center panel`, timeout: 10_000 }
    )
    .toEqual({ column: 0, center: 0 })
  return readSeam(page)
}

/** Drags the sidebar's own resize handle, the way a person resizes it. */
async function dragSidebarEdge(page: Page, toX: number): Promise<void> {
  const handle = page.locator('[data-sidebar-resize-handle]')
  const box = await handle.boundingBox()
  if (!box) {
    throw new Error('sidebar resize handle has no box')
  }
  const y = box.y + box.height / 2
  // Why left of center: the handle straddles the edge, and the sidebar clips its outer half.
  await page.mouse.move(box.x + 2, y)
  await page.mouse.down()
  await page.mouse.move(toX, y, { steps: 8 })
  await page.mouse.up()
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

test.describe('sidebar meets the center panel (ORCA-1244)', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await dismissWorkspaceBoardMovedHint(orcaPage)
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
  })

  test('leaves no strip at rest and after dragging narrower and wider', async ({ orcaPage }) => {
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await orcaPage.evaluate(
      (width) => window.__store!.getState().setSidebarWidth(width),
      DEFAULT_WIDTH
    )
    await expectNoStrip(orcaPage, 'at rest')

    await dragSidebarEdge(orcaPage, 0)
    const narrow = await expectNoStrip(orcaPage, 'dragged narrowest')
    expect(narrow.sidebarRight).toBe(NARROWEST)
    // The header gives way inside the column instead: Back and Forward stay on screen.
    for (const name of ['Go back', 'Go forward']) {
      const button = await orcaPage.getByRole('button', { name, exact: true }).boundingBox()
      expect(button, `${name} is drawn`).not.toBeNull()
      expect(button!.x + button!.width, `${name} stays inside the sidebar`).toBeLessThanOrEqual(
        NARROWEST
      )
    }

    await dragSidebarEdge(orcaPage, 1000)
    const wide = await expectNoStrip(orcaPage, 'dragged widest')
    expect(wide.sidebarRight).toBe(WIDEST)

    await dragSidebarEdge(orcaPage, 300)
    await expectNoStrip(orcaPage, 'dragged back between')
  })

  test('leaves no strip at every window width and theme, narrow and wide', async ({
    orcaPage
  }, testInfo) => {
    await writeSettings(orcaPage, { uiLanguage: 'es' })
    await orcaPage.mouse.move(0, 0)
    for (const viewport of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width: viewport, height: 900 })
      for (const sidebar of [NARROWEST, viewport >= 768 ? 470 : DEFAULT_WIDTH]) {
        await orcaPage.evaluate(
          (width) => window.__store!.getState().setSidebarWidth(width),
          sidebar
        )
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          await expectNoStrip(orcaPage, `${viewport} px, sidebar ${sidebar}, ${theme}`)
          await orcaPage.screenshot({
            animations: 'disabled',
            // Why: the shell prompt names the machine's user and host.
            mask: [orcaPage.locator('.xterm-screen')],
            maskColor: '#6b7280',
            path: testInfo.outputPath(`seam-${viewport}-sidebar${sidebar}-${theme}.png`)
          })
        }
      }
    }
  })
})
