/**
 * ORCA-1053: a saved arcade play runs in a center tab beside Claude. Space, ArrowUp and a tap jump,
 * Esc goes back to the conversation, and the run stands still while an agent waits on the user.
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

async function setWaiting(page: Page, worktreeId: string, isWaiting: boolean): Promise<void> {
  await page.evaluate(
    ({ id, waiting }) => {
      const now = Date.now()
      window.__store!.setState({
        agentStatusByPaneKey: waiting
          ? {
              'e2e-arcade:1': {
                state: 'waiting',
                prompt: '',
                updatedAt: now,
                stateStartedAt: now,
                paneKey: 'e2e-arcade:1',
                worktreeId: id,
                stateHistory: []
              }
            }
          : {}
      })
    },
    { id: worktreeId, waiting: isWaiting }
  )
}

async function openArcade(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate((id) => window.__store!.getState().openGameArcadeTab(id), worktreeId)
  await expect(page.locator(BOX).first()).toBeVisible()
  // Why: the first frame paints once the resize observer has measured the box.
  await page.waitForTimeout(300)
}

async function expectInputStartsRun(
  page: Page,
  input: (box: Locator) => Promise<void>,
  because: string
): Promise<void> {
  const ready = await canvasPixels(page)
  await input(page.locator(BOX).first())
  await page.waitForTimeout(400)
  expect(await canvasPixels(page), because).not.toBe(ready)
}

for (const theme of THEMES) {
  test(`the arcade tab plays beside Claude and goes back on Esc (${theme}) @headful`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(180_000)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await setTheme(orcaPage, theme)
    await openArcade(orcaPage, worktreeId)
    const box = orcaPage.locator(BOX).first()

    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await orcaPage.waitForTimeout(400)
      await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-ready-${theme}-${width}.png`) })
    }

    await setWindowWidth(electronApp, orcaPage, 1440)
    await orcaPage.waitForTimeout(400)
    await expectInputStartsRun(orcaPage, (b) => b.press('Space'), 'Space starts the run')
    await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-running-${theme}.png`) })

    await setWaiting(orcaPage, worktreeId, true)
    await orcaPage.waitForTimeout(300)
    const held = await canvasPixels(orcaPage)
    await orcaPage.waitForTimeout(500)
    expect(await canvasPixels(orcaPage), 'the run stands still while someone needs you').toBe(held)
    await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-held-${theme}.png`) })
    await setWaiting(orcaPage, worktreeId, false)
    await orcaPage.waitForTimeout(300)
    expect(await canvasPixels(orcaPage), 'the run goes on once answered').not.toBe(held)

    // Why focus, not click: a click on a run that just ended is a press, and closes the tab.
    await box.focus()
    await box.press('Escape')
    await expect.poll(() => tabTypeOf(orcaPage, worktreeId)).toBe('terminal')
    await orcaPage.screenshot({ path: testInfo.outputPath(`arcade-back-${theme}.png`) })

    // Each saved play is a fresh run, so every input is checked from the ready screen.
    await openArcade(orcaPage, worktreeId)
    await expectInputStartsRun(orcaPage, (b) => b.press('ArrowUp'), 'ArrowUp starts the run')
    await openArcade(orcaPage, worktreeId)
    await expectInputStartsRun(orcaPage, (b) => b.click(), 'a tap starts the run')
  })
}
