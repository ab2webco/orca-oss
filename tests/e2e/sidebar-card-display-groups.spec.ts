/**
 * ORCA-1163: the new card style's Card display heads its toggles with Work, Agent and Source,
 * and offers the PR toggle the team row already reads. Captured at every width and theme.
 */
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** Non-scroller elements scrolled sideways: a popup that takes focus can scroll an overflowing app column. */
function scrolledSideways(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((node) => {
        // Why: tab strips and code views scroll sideways by design; only clipped layout must stay put.
        const overflowX = getComputedStyle(node).overflowX
        return node.scrollLeft > 0 && overflowX !== 'auto' && overflowX !== 'scroll'
      })
      .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 80)}`)
  )
}

test.describe('narrow-width app shell (ORCA-1163)', () => {
  test('the overlaid right panel stays on screen, resizable and closable at 390 and 320', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    for (const width of [390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setSidebarOpen(true)
        state.setRightSidebarOpen(true)
      })
      const overlay = orcaPage.locator('[data-right-sidebar-overlay]')
      await expect(overlay).toBeVisible()
      const box = (await overlay.boundingBox())!
      expect(
        box.x + box.width,
        `${width}px: the panel ends at the window edge`
      ).toBeLessThanOrEqual(width + 1)
      const handle = (await overlay.locator('[data-right-sidebar-resize]').boundingBox())!
      expect(handle.x, `${width}px: the resize handle is on screen`).toBeGreaterThanOrEqual(0)
      await orcaPage.mouse.move(handle.x + 1, handle.y + 40)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(handle.x - 30, handle.y + 40)
      await orcaPage.mouse.up()
      await expect(overlay).toBeVisible()
      await overlay.getByRole('button', { name: 'Toggle right sidebar' }).click()
      await expect
        .poll(() => orcaPage.evaluate(() => window.__store!.getState().rightSidebarOpen))
        .toBe(false)
    }
  })

  // Why: the before/after evidence that wide layouts did not move with the narrow-width fix.
  test('captures the wide shell with both sidebars open', async ({ orcaPage }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    for (const width of [1440, 768]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setSidebarOpen(true)
        state.setRightSidebarOpen(true)
      })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`shell-${width}-${theme}.png`)
        })
      }
    }
  })
})

test.describe('Card display groups', () => {
  test('keeps the app in place at narrow widths when the options menu opens', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await writeSettings(orcaPage, { experimentalNewWorktreeCardStyle: true })
    for (const width of [390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setSidebarOpen(true)
        state.setRightSidebarOpen(true)
      })
      await expect(orcaPage.getByRole('menu')).toHaveCount(0)
      expect(await scrolledSideways(orcaPage), `${width}px before opening`).toEqual([])
      // Why the keyboard: the right drawer covers this button at 390, as a keyboard user can still reach it.
      await orcaPage.locator('button[aria-label^="Workspace options"]').first().focus()
      await orcaPage.keyboard.press('Enter')
      await orcaPage.getByRole('menuitem', { name: /Card display/ }).focus()
      await orcaPage.keyboard.press('ArrowRight')
      await expect(orcaPage.locator('[data-card-display-group]').first()).toBeVisible()
      expect(await scrolledSideways(orcaPage), `${width}px with the menu open`).toEqual([])
      await orcaPage.keyboard.press('Escape')
      await orcaPage.keyboard.press('Escape')
    }
  })

  test('heads the toggles with Work, Agent and Source and offers the PR toggle', async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await writeSettings(orcaPage, { experimentalNewWorktreeCardStyle: true })

    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      // Why close the right panel: at 390 and 320 it is a drawer over the sidebar (ORCA-1163).
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setSidebarOpen(true)
        state.setRightSidebarOpen(false)
      })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        // Why wait for zero: a menu still animating out reads as visible for ~100 ms and swallows the click.
        await expect(orcaPage.getByRole('menu')).toHaveCount(0)
        await orcaPage.locator('button[aria-label^="Workspace options"]:visible').first().click()
        const cardDisplay = orcaPage.getByRole('menuitem', { name: /Card display/ })
        await cardDisplay.hover()
        const groups = orcaPage.locator('[data-card-display-group]')
        await expect(groups).toHaveText(['Work', 'Agent', 'Source'])
        // At 320 the options menu's left column was cut ('atus', 'branch').
        const mainMenu = orcaPage
          .getByRole('menu')
          .filter({ has: orcaPage.getByRole('menuitem', { name: /Card display/ }) })
        await expect
          .poll(
            async () => {
              const box = await mainMenu.boundingBox()
              return box ? box.x >= 0 && box.x + box.width <= width : false
            },
            { message: `${width}px ${theme}: the options menu leaves the window` }
          )
          .toBe(true)
        // At 320 the submenu was cut at the window's right edge ('Pull request and ch...').
        const submenu = orcaPage.locator('[role="menu"]:has([data-card-display-group])')
        await expect
          .poll(
            async () => {
              const box = await submenu.boundingBox()
              return box ? box.x >= 0 && box.x + box.width <= width : false
            },
            { message: `${width}px ${theme}: the Card display submenu leaves the window` }
          )
          .toBe(true)
        await expect(
          orcaPage.getByRole('menuitemcheckbox', { name: 'Pull request and checks' })
        ).toBeVisible()
        const overflow = await orcaPage.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
        expect(overflow, `${width}px ${theme}: the page scrolls sideways`).toBeLessThanOrEqual(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`card-display-${width}-${theme}.png`)
        })
        await orcaPage.keyboard.press('Escape')
        await orcaPage.keyboard.press('Escape')
      }
    }
  })
})
