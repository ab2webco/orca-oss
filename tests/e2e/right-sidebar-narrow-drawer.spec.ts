import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const CAPTURE_WIDTHS = [768, 390, 320]
const DRAWER = '[data-right-sidebar-overlay]'
const SCRIM = '[data-right-sidebar-scrim]'
const LEFT_SIDEBAR = '[data-worktree-sidebar-root]'

async function setRightPanelOpen(page: Page, open: boolean): Promise<void> {
  await page.evaluate((next) => window.__store!.getState().setRightSidebarOpen(next), open)
}

function focusIsIn(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target) => Boolean(document.activeElement?.closest(target)), selector)
}

// ORCA-1220: below the column breakpoint the right panel used to float over the left sidebar with
// no way past it but its own toggle.
test('below the column breakpoint the right panel is a drawer that a scrim or Escape closes', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setRightSidebarOpen(false)
  })

  await orcaPage.setViewportSize({ width: 390, height: 844 })
  const toggle = orcaPage.locator('[data-right-sidebar-toggle]:visible').first()
  await toggle.click()
  await expect(orcaPage.locator(DRAWER)).toBeVisible()
  await expect(orcaPage.locator(SCRIM)).toBeVisible()
  await expect
    .poll(() => focusIsIn(orcaPage, DRAWER), { message: 'focus never entered' })
    .toBe(true)

  // Why: the click leaves the pointer on the drawer's close button, whose tooltip takes the first Escape.
  const drawerBox = await orcaPage.locator(DRAWER).boundingBox()
  await orcaPage.mouse.move(
    drawerBox!.x + drawerBox!.width / 2,
    drawerBox!.y + drawerBox!.height / 2
  )
  await expect(orcaPage.getByRole('tooltip')).toHaveCount(0)
  await orcaPage.keyboard.press('Escape')
  await expect(orcaPage.locator(DRAWER)).toHaveCount(0)
  await expect(orcaPage.locator(SCRIM)).toHaveCount(0)
  await expect
    .poll(() => focusIsIn(orcaPage, '[data-right-sidebar-toggle]'), {
      message: 'focus did not return to the toggle'
    })
    .toBe(true)

  await toggle.click()
  await expect(orcaPage.locator(SCRIM)).toBeVisible()
  const sidebarBox = await orcaPage.locator(LEFT_SIDEBAR).boundingBox()
  expect(sidebarBox, 'the left sidebar is not laid out').not.toBeNull()
  const point = { x: sidebarBox!.x + 24, y: sidebarBox!.y + sidebarBox!.height / 2 }
  const coveredBy = await orcaPage.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute('data-right-sidebar-scrim'),
    point
  )
  expect(coveredBy, 'the scrim does not cover the left sidebar').toBe(true)
  await orcaPage.mouse.click(point.x, point.y)
  await expect(orcaPage.locator(DRAWER)).toHaveCount(0)
  const reachesSidebar = await orcaPage.evaluate(
    ({ x, y, selector }) => Boolean(document.elementFromPoint(x, y)?.closest(selector)),
    { ...point, selector: LEFT_SIDEBAR }
  )
  expect(reachesSidebar, 'the left sidebar is still covered after the drawer closed').toBe(true)
  // The drawer never closes or narrows the left sidebar.
  expect(await orcaPage.evaluate(() => window.__store!.getState().sidebarOpen)).toBe(true)

  await orcaPage.setViewportSize({ width: 768, height: 900 })
  await setRightPanelOpen(orcaPage, true)
  await expect(orcaPage.locator('[data-right-sidebar-resize]')).toBeVisible()
  await expect(orcaPage.locator(DRAWER)).toHaveCount(0)
  await expect(orcaPage.locator(SCRIM)).toHaveCount(0)

  for (const width of CAPTURE_WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 844 })
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(orcaPage, { theme })
      for (const open of [false, true]) {
        await setRightPanelOpen(orcaPage, open)
        await expect(orcaPage.locator(SCRIM)).toHaveCount(open && width < 768 ? 1 : 0)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${width}-${theme}-${open ? 'open' : 'closed'}.png`)
        })
      }
    }
  }
})
