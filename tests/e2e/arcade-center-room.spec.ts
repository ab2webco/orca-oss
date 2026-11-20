/**
 * ORCA-1299: at 768 with both side panels open the center is ~137 px, and an Arcade game drew as a
 * strip with cells a few pixels wide. Opening the Arcade now closes the right panel when the center
 * is under 360 px; a wide window keeps it, and a panel the person reopens stays open.
 */
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'

const BOX = '[data-arcade-tab]'
const soft = expect.configure({ soft: true })

const boxWidthOf = (page: Page): Promise<number> =>
  page
    .locator(BOX)
    .first()
    .evaluate((box) => box.clientWidth)

const rightOpenOf = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.__store!.getState().rightSidebarOpen)

for (const theme of THEMES) {
  test(`the Arcade makes room for its game in a narrow center (${theme})`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(180_000)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await setTheme(orcaPage, theme)
    await orcaPage.evaluate(() =>
      window.localStorage.setItem('orca.workspaceBoardMovedHintSeen.v1', 'true')
    )

    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      // Why closed below ~480 px: there the panels overlay the center (ORCA-1220), and nothing changed.
      const isNarrow = width < 480
      await orcaPage.evaluate(
        ({ id, narrow }) => {
          const state = window.__store!.getState()
          state.setActiveTabTypeForWorktree(id, 'terminal')
          state.setSidebarOpen(!narrow)
          state.setRightSidebarOpen(!narrow)
        },
        { id: worktreeId, narrow: isNarrow }
      )
      await orcaPage.evaluate(
        (id) => window.__store!.getState().openGameArcadeTab(id, 'snake'),
        worktreeId
      )
      await expect(orcaPage.locator(BOX).first()).toBeVisible()

      // Why soft: a run against main still captures every width before it reports the strip.
      if (width === 768) {
        await soft
          .poll(() => boxWidthOf(orcaPage), { message: 'the game gets at least 360 px' })
          .toBeGreaterThanOrEqual(360)
        soft(await rightOpenOf(orcaPage), 'the right panel closed to make room').toBe(false)
      } else if (!isNarrow) {
        expect(await rightOpenOf(orcaPage), 'a wide center keeps the right panel').toBe(true)
      }

      await orcaPage.waitForTimeout(400)
      await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-${theme}-${width}.png`) })

      if (width === 768) {
        // Why: once the game has its room, a panel the person reopens over it must stay open.
        await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(true))
        await expect.poll(() => boxWidthOf(orcaPage)).toBeLessThan(360)
        await orcaPage.waitForTimeout(500)
        expect(await rightOpenOf(orcaPage), 'a reopened right panel stays open').toBe(true)
      }
    }
  })
}
