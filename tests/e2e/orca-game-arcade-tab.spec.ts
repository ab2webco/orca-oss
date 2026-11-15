/**
 * ORCA-1053, ORCA-1241: a saved arcade play runs in a center tab beside Claude. Space, ArrowUp and a
 * tap jump, Esc goes back to the conversation keeping the run, and the run stands still while a live
 * agent waits on the user, naming it. A sleeping pane left waiting in another project holds nothing.
 * Opens the tab through the store action the panel's Play button calls; the credit itself is the
 * host's (unit-tested), so no game state is seeded here.
 * @headful: the run moves on requestAnimationFrame, which never fires in a window that is never shown.
 */
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'

const BOX = '[data-arcade-tab]'
const CANVAS = `${BOX} canvas`

const canvasPixels = (page: Page): Promise<string> =>
  page.evaluate(
    (selector) => (document.querySelector(selector) as HTMLCanvasElement | null)?.toDataURL() ?? '',
    CANVAS
  )

const tabTypeOf = (page: Page, worktreeId: string): Promise<string | undefined> =>
  page.evaluate((id) => window.__store!.getState().activeTabTypeByWorktree[id], worktreeId)

/** A terminal tab of the worktree with a live PTY: the pane a live member would run in. */
async function liveTabOf(page: Page, worktreeId: string): Promise<string> {
  let tabId: string | undefined
  await expect
    .poll(async () => {
      tabId = await page.evaluate((id) => {
        const state = window.__store!.getState()
        return (state.tabsByWorktree[id] ?? []).find(
          (tab) => (state.ptyIdsByTabId[tab.id]?.length ?? 0) > 0
        )?.id
      }, worktreeId)
      return tabId
    })
    .toBeTruthy()
  return tabId!
}

/**
 * Always a sleeping pane in another project left `waiting` (the owner's report); with `blockedTab`,
 * also a live member blocked on a permission in that tab.
 */
async function seedStatuses(page: Page, blockedTab: string | null): Promise<void> {
  await page.evaluate((liveTab) => {
    const now = Date.now()
    const row = (paneKey: string, state: 'waiting' | 'blocked', extra: object) => ({
      state,
      prompt: '',
      updatedAt: now,
      stateStartedAt: now,
      paneKey,
      stateHistory: [],
      ...extra
    })
    window.__store!.setState({
      agentStatusByPaneKey: {
        // Why fresh-looking: only the missing live PTY tells this row apart from a real wait.
        'e2e-sleeping-tab:leaf': row('e2e-sleeping-tab:leaf', 'waiting', {
          worktreeId: 'e2e-cronos-netsat'
        }),
        ...(liveTab
          ? {
              [`${liveTab}:leaf`]: row(`${liveTab}:leaf`, 'blocked', {
                orchestration: { taskId: 'e2e', dispatchId: 'e2e', displayName: 'Luigi' }
              })
            }
          : {})
      }
    })
  }, blockedTab)
}

async function openArcade(page: Page, worktreeId: string): Promise<Locator> {
  await page.evaluate((id) => window.__store!.getState().openGameArcadeTab(id), worktreeId)
  const box = page.locator(BOX).first()
  await expect(box).toBeVisible()
  // Why: the first frame paints once the resize observer has measured the box.
  await page.waitForTimeout(300)
  return box
}

async function expectMoving(page: Page, because: string): Promise<void> {
  const before = await canvasPixels(page)
  await page.waitForTimeout(300)
  expect(await canvasPixels(page), because).not.toBe(before)
}

async function expectStill(page: Page, because: string): Promise<string> {
  await page.waitForTimeout(300)
  const held = await canvasPixels(page)
  await page.waitForTimeout(500)
  expect(await canvasPixels(page), because).toBe(held)
  return held
}

async function expectInputStartsRun(
  page: Page,
  input: (box: Locator) => Promise<void>,
  box: Locator,
  because: string
): Promise<void> {
  const ready = await canvasPixels(page)
  await input(box)
  await page.waitForTimeout(400)
  expect(await canvasPixels(page), because).not.toBe(ready)
}

for (const theme of THEMES) {
  test(`the arcade plays beside Claude, holds only for a live agent and goes back on Esc (${theme}) @headful`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(240_000)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const liveTab = await liveTabOf(orcaPage, worktreeId)
    await setTheme(orcaPage, theme)
    await seedStatuses(orcaPage, null)

    // Each width gets a fresh play, so a run never lasts long enough to crash mid-check.
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      // Why: below ~480 px the side panels cover the center (ORCA-1220), hiding the run itself.
      await orcaPage.evaluate((isNarrow) => {
        window.__store!.getState().setSidebarOpen(!isNarrow)
        window.__store!.getState().setRightSidebarOpen(!isNarrow)
      }, width < 480)
      const box = await openArcade(orcaPage, worktreeId)
      await orcaPage.waitForTimeout(200)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`arcade-ready-${theme}-${width}.png`)
      })
      await box.press('Space')
      await expectMoving(orcaPage, 'a sleeping pane in another project does not hold the run')
      await orcaPage.screenshot({
        path: testInfo.outputPath(`arcade-running-${theme}-${width}.png`)
      })
      await seedStatuses(orcaPage, liveTab)
      await expectStill(orcaPage, 'a live member blocked on a permission holds the run')
      await orcaPage.screenshot({
        path: testInfo.outputPath(`arcade-held-${theme}-${width}.png`)
      })
      await seedStatuses(orcaPage, null)
      await expectMoving(orcaPage, 'the run goes on once the member is answered')
    }

    await setWindowWidth(electronApp, orcaPage, 1440)
    const box = await openArcade(orcaPage, worktreeId)
    await box.press('Space')
    await seedStatuses(orcaPage, liveTab)
    const held = await expectStill(orcaPage, 'held before going back')
    // Why focus, not click: a click on a run that just ended is a press, and closes the tab.
    await box.focus()
    await box.press('Escape')
    await expect.poll(() => tabTypeOf(orcaPage, worktreeId)).toBe('terminal')
    await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-back-${theme}.png`) })
    // Why activateTab: it is how the tab strip brings the Arcade tab back, the way Esc left it.
    await orcaPage.evaluate((id) => {
      const state = window.__store!.getState()
      const arcade = (state.unifiedTabsByWorktree[id] ?? []).find(
        (tab) => tab.entityId === `orca-arcade::${id}`
      )
      if (arcade) {
        state.activateTab(arcade.id, { worktreeId: id })
      }
    }, worktreeId)
    await expect(box).toBeVisible()
    await orcaPage.waitForTimeout(400)
    expect(await canvasPixels(orcaPage), 'Esc keeps the run where it was').toBe(held)
    await seedStatuses(orcaPage, null)

    // Played out: with no jump, the runner meets the first obstacle.
    await expect
      .poll(
        async () => {
          const before = await canvasPixels(orcaPage)
          await orcaPage.waitForTimeout(400)
          return (await canvasPixels(orcaPage)) === before
        },
        { timeout: 20_000, message: 'the run ends' }
      )
      .toBe(true)
    await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-over-${theme}.png`) })
    await box.press('Space')
    await expect.poll(() => tabTypeOf(orcaPage, worktreeId)).toBe('terminal')

    // Each saved play is a fresh run, so every input is checked from the ready screen.
    const inputs: [string, (b: Locator) => Promise<void>][] = [
      ['ArrowUp', (b) => b.press('ArrowUp')],
      ['a tap', (b) => b.click()]
    ]
    for (const [name, input] of inputs) {
      const fresh = await openArcade(orcaPage, worktreeId)
      await expectInputStartsRun(orcaPage, input, fresh, `${name} starts the run`)
    }
  })
}
