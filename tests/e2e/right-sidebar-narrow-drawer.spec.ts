import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const CAPTURE_WIDTHS = [1440, 768, 390, 320]
const DRAWER = '[data-right-sidebar-overlay]'
const SCRIM = '[data-right-sidebar-scrim]'
const LEFT_SIDEBAR = '[data-worktree-sidebar-root]'

async function setRightPanelOpen(page: Page, open: boolean): Promise<void> {
  await page.evaluate((next) => window.__store!.getState().setRightSidebarOpen(next), open)
}

function focusIsIn(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target) => Boolean(document.activeElement?.closest(target)), selector)
}

// Read once, with no retry: what a person sees in the frame the drawer opens.
function tooltipsOverDrawer(page: Page): Promise<string[]> {
  return page.evaluate((drawerSelector) => {
    const drawer = document.querySelector(drawerSelector)?.getBoundingClientRect()
    if (!drawer) {
      return ['no drawer']
    }
    return [...document.querySelectorAll('[data-slot="tooltip-content"]')]
      .filter((node) => {
        const box = node.getBoundingClientRect()
        return (
          box.width > 0 &&
          box.right > drawer.left &&
          box.left < drawer.right &&
          box.bottom > drawer.top &&
          box.top < drawer.bottom
        )
      })
      .map((node) => node.textContent ?? '')
  }, DRAWER)
}

// As team-panel-action-dock.spec.ts does: clearing the seen flag and remounting the toolbar shows it.
async function reopenBoardHint(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem('orca.workspaceBoardMovedHintSeen.v1')
    window.__store!.getState().setSidebarOpen(false)
  })
  await expect(page.locator('[data-workspace-board-trigger]')).toHaveCount(0)
  await page.evaluate(() => window.__store!.getState().setSidebarOpen(true))
  await expect(page.locator('[data-workspace-board-trigger]')).toHaveCount(1)
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
  // Why the hint: a tooltip from the covered sidebar floated over the drawer and took its Escape.
  await reopenBoardHint(orcaPage)
  await expect(
    orcaPage.locator('[data-slot="tooltip-content"]', { hasText: 'Workspace board moved' }),
    'the board-moved hint is not showing, so the checks below prove nothing'
  ).toBeVisible()
  const toggle = orcaPage.locator('[data-right-sidebar-toggle]:visible').first()
  await toggle.click()
  await expect(orcaPage.locator(DRAWER)).toBeVisible()
  expect(await tooltipsOverDrawer(orcaPage), 'a tooltip lies over the drawer as it opens').toEqual(
    []
  )
  await expect(orcaPage.locator(SCRIM)).toBeVisible()
  await expect
    .poll(() => focusIsIn(orcaPage, DRAWER), { message: 'focus never entered' })
    .toBe(true)

  // One Escape closes the drawer.
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

  // A field that handles Escape keeps the drawer open: the first clears the search, the next closes.
  await orcaPage.evaluate(() => window.__store!.getState().showRightSidebarSearch())
  const search = orcaPage.getByRole('textbox', { name: 'Search files' })
  await search.click()
  await search.fill('README')
  await orcaPage.keyboard.press('Escape')
  await expect(search).toHaveValue('')
  await expect(orcaPage.locator(DRAWER)).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await expect(orcaPage.locator(DRAWER)).toHaveCount(0)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.showRightSidebarFiles()
    state.setRightSidebarOpen(false)
  })

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
        const drawerOpen = open && width < 768
        await expect(orcaPage.locator(SCRIM)).toHaveCount(drawerOpen ? 1 : 0)
        if (drawerOpen) {
          expect(
            await tooltipsOverDrawer(orcaPage),
            `a tooltip over the drawer at ${width}`
          ).toEqual([])
        }
        const name = `${width}-${theme}-${open ? 'open' : 'closed'}.png`
        const shot = await orcaPage.screenshot({ path: testInfo.outputPath(name) })
        // Why attached: CI keeps test-results only on failure; the JSON report carries the narrow captures on green runs too.
        if (width < 768) {
          await testInfo.attach(name, { body: shot, contentType: 'image/png' })
        }
      }
    }
  }
})

// ORCA-1220: Windows and Linux draw their window controls over the titlebar's top right, and at 390 the
// toggle sat under the left sidebar, where no click reached it.
test('with custom window controls the right toggle stays reachable at narrow widths', async ({
  orcaPage
}) => {
  await orcaPage.addInitScript(() => {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146 Safari/537.36'
    Object.defineProperty(navigator, 'userAgent', { get: () => userAgent, configurable: true })
  })
  await orcaPage.reload({ waitUntil: 'domcontentloaded' })
  await orcaPage.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await expect(orcaPage.locator('.window-controls')).toBeVisible()
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setRightSidebarOpen(false)
  })

  for (const width of [390, 320]) {
    await orcaPage.setViewportSize({ width, height: 844 })
    const toggle = orcaPage.locator('[data-right-sidebar-toggle]:visible').first()
    await expect(toggle).toBeVisible()
    const placement = await toggle.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const controls = document.querySelector('.window-controls')!.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return {
        reachable: Boolean(hit && node.contains(hit)),
        underWindowControls:
          box.right > controls.left &&
          box.left < controls.right &&
          box.bottom > controls.top &&
          box.top < controls.bottom
      }
    })
    expect(placement, `the right toggle at ${width}`).toEqual({
      reachable: true,
      underWindowControls: false
    })
    await toggle.click()
    await expect(orcaPage.locator(DRAWER)).toBeVisible()
    await orcaPage.keyboard.press('Escape')
    await expect(orcaPage.locator(DRAWER)).toHaveCount(0)
  }
})
