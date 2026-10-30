import { rm } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'

// The arcade's offer drawn by the orca-game mod inside a real Claude Code, in two scenes and the
// app's light and dark theme at 1440, 768, 390 and 320 px: the scene celebrates, the countdown
// ticks on screen, and the pane closes by itself when it ends; its `j` plays instead of reaching the
// prompt.
const WIDTHS = [1440, 768, 390, 320]
const SCENES = ['quest', 'vigilante']
// Why joined with spaces: a narrow pane wraps the countdown line.
const SECONDS_LEFT = /(\d{1,2})s to\s+choose/

const gameState = (scene: string) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene },
  warnings: [],
  worktree: { id: 'demo-wt', path: '/work/arcade', branch: 'main', displayName: 'arcade' },
  agents: [],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
})

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

// Why per width: a late startup write can reopen the right sidebar and squeeze the terminal.
async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

const screenOf = async (page: Page): Promise<string> => (await screenRows(page)).join(' ')

const secondsLeftOf = async (page: Page): Promise<number | undefined> => {
  const found = SECONDS_LEFT.exec(await screenOf(page))
  return found === null ? undefined : Number(found[1])
}

for (const scene of SCENES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the arcade offer celebrates, counts down and closes by itself (${scene}, ${theme})`, async ({
      electronApp,
      orcaPage,
      testRepoPath
    }, testInfo) => {
      test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
      test.setTimeout(300_000)
      await waitForSessionReady(orcaPage)
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
      const band = await startGameBand(orcaPage, testRepoPath, {
        state: gameState(scene),
        theme,
        locale: 'en',
        scene
      })
      try {
        await expect
          .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the band never drew' })
          .toContain('Panel')
        for (const width of WIDTHS) {
          await closeSidebars(orcaPage)
          await setWindowWidth(electronApp, orcaPage, width)
          await orcaPage.waitForTimeout(1_000)
          await orcaPage.keyboard.type('/orca-game:demo offer')
          await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('demo offer')
          // Why Enter again: an Enter that lands while the composer still settles the text is dropped.
          await expect
            .poll(
              async () => {
                const left = await secondsLeftOf(orcaPage)
                if (left === undefined) {
                  await orcaPage.keyboard.press('Enter')
                }
                return left
              },
              { timeout: 30_000, intervals: [2_000], message: `no offer at ${width}px` }
            )
            .toBeDefined()
          // The celebration lasts about 3 s: this frame catches it.
          await orcaPage.screenshot({
            path: testInfo.outputPath(`offer-${scene}-${theme}-${width}.png`),
            animations: 'disabled'
          })
          const first = (await secondsLeftOf(orcaPage))!
          await expect
            .poll(() => secondsLeftOf(orcaPage), { timeout: 10_000 })
            .toBeLessThanOrEqual(first - 3)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`countdown-${scene}-${theme}-${width}.png`),
            animations: 'disabled'
          })
          expect(await screenOf(orcaPage), `play and pass at ${width}px`).toMatch(
            /j: play[\s\S]*n: pass/
          )
          await expect
            .poll(() => secondsLeftOf(orcaPage), {
              timeout: 20_000,
              message: `the offer never closed at ${width}px`
            })
            .toBeUndefined()
          expect(await screenOf(orcaPage), `pane gone at ${width}px`).not.toContain('n: pass')
        }
      } finally {
        await rm(band.root, { recursive: true, force: true })
      }
    })
  }
}

test('the arcade offer takes j from an empty prompt and plays, typing nothing in the chat', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: gameState('quest'),
    theme: 'dark',
    locale: 'en',
    scene: 'quest'
  })
  try {
    await expect
      .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the band never drew' })
      .toContain('Panel')
    await closeSidebars(orcaPage)
    await orcaPage.keyboard.type('/orca-game:demo offer')
    await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('demo offer')
    await expect
      .poll(
        async () => {
          const left = await secondsLeftOf(orcaPage)
          if (left === undefined) {
            await orcaPage.keyboard.press('Enter')
          }
          return left
        },
        { timeout: 30_000, intervals: [2_000], message: 'no offer' }
      )
      .toBeDefined()
    expect(await screenOf(orcaPage), 'the pane holds the keyboard').not.toContain('ctrl+x tab')
    await orcaPage.keyboard.press('j')
    await expect
      .poll(() => screenOf(orcaPage), { timeout: 10_000, message: 'j never started the run' })
      .toContain('j: jump')
    expect(await secondsLeftOf(orcaPage), 'the offer is gone once played').toBeUndefined()
    await orcaPage.screenshot({
      path: testInfo.outputPath('offer-played.png'),
      animations: 'disabled'
    })
    // Esc closes the run and hands the keyboard back: a j the prompt had taken would show there now.
    await orcaPage.keyboard.press('Escape')
    await expect.poll(() => screenOf(orcaPage), { timeout: 10_000 }).not.toContain('j: jump')
    await orcaPage.screenshot({
      path: testInfo.outputPath('offer-closed.png'),
      animations: 'disabled'
    })
    expect((await screenRows(orcaPage)).some((row) => /^\s*[>❯]\s*j\s*$/.test(row))).toBe(false)
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
