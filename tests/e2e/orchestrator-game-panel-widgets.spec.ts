import { rm } from 'node:fs/promises'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import {
  claudeVersionOk,
  clickTerminalText,
  screenRows,
  startGameBand,
  terminalPointOf
} from './helpers/orchestrator-game-band'

// The project and its To Do items are invented; see the helper for what the band needs to draw.
const HOLD_MS = 1_500
const TODO_HEADING = '▾ To Do 12'
const TEAM_HEADING = '▾ Team 2'
// Why: Claude Code's terminal loses a click that lands while a pane redraws (keys are not lost),
// so each chip is clicked once, after the redraw that drew it.
const REDRAW_MS = 1_000

const todoItem = (id: string, title: string) => ({
  id,
  title,
  url: `https://plane.example/${id}`,
  group: 'todo'
})

const gameState = {
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  sources: {},
  warnings: [],
  worktree: { id: 'widgets-wt', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    {
      paneKey: 'demo-wren',
      displayName: 'Wren',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: false,
      isMember: true,
      worktree: { id: 'demo-wt-lum-12', branch: 'feat/lum-12', displayName: 'LUM-12' },
      workItem: {
        provider: 'plane',
        identifier: 'LUM-12',
        title: 'Dark mode toggle',
        url: 'https://plane.example/LUM-12',
        status: 'In Progress',
        statusGroup: 'in_progress'
      }
    }
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  project: {
    reviews: null,
    todo: {
      provider: 'plane',
      total: 12,
      url: 'https://plane.example/todo',
      items: [
        todoItem('LUM-12', 'Dark mode toggle'),
        todoItem('LUM-14', 'Offline cache for the feed')
      ],
      groups: { todo: 12 }
    }
  },
  role: 'lead',
  locale: 'en'
}

const screenText = async (page: Page) => (await screenRows(page)).join('\n')

async function clickOnceRedrawn(page: Page, chip: string): Promise<void> {
  await page.waitForTimeout(REDRAW_MS)
  await clickTerminalText(page, chip)
}

/** Wheels the Panel down until `heading` is on screen, so a short docked pane still shows it. */
async function scrollPanelTo(page: Page, heading: string): Promise<void> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel menu is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 20 && !(await screenText(page)).includes(heading); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
  }
  expect(await screenText(page)).toContain(heading)
}

/**
 * One screenshot per theme and width, `<name>-<theme>-<width>.png`, plus a `-scrolled` one where
 * the docked Panel is too short to show `heading` unscrolled.
 */
async function captureEveryWidth(
  electronApp: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  name: string,
  heading: string
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, page, width)
      await page.waitForTimeout(HOLD_MS)
      const shot = `${name}-${theme}-${width}`
      await page.screenshot({ path: testInfo.outputPath(`${shot}.png`), animations: 'disabled' })
      if (!(await screenText(page)).includes(heading)) {
        await scrollPanelTo(page, heading)
        await page.waitForTimeout(HOLD_MS)
        await page.screenshot({
          path: testInfo.outputPath(`${shot}-scrolled.png`),
          animations: 'disabled'
        })
        await page.mouse.wheel(0, -2_400)
      }
    }
  }
}

test('the Panel shows Team alone until a person adds To Do from the Widgets menu', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(900_000)
  await waitForSessionReady(orcaPage)
  // Why 1440: the clicks need the wide menu labels, not the phone chips.
  await setWindowWidth(electronApp, orcaPage, 1440)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: gameState,
    theme: 'dark',
    locale: 'en'
  })
  try {
    // Why Wren: the band must have drawn the member before a click reaches the Panel chip.
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Wren')
    await clickOnceRedrawn(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')
    // The band's chip reads "To Do 12"; only the Panel's section heading would read "▾ To Do".
    expect(await screenText(orcaPage)).not.toContain('▾ To Do')
    await captureEveryWidth(electronApp, orcaPage, testInfo, 'panel-default', TEAM_HEADING)

    await setWindowWidth(electronApp, orcaPage, 1440)
    await expect.poll(async () => screenText(orcaPage), { timeout: 30_000 }).toContain('Widgets')
    await clickOnceRedrawn(orcaPage, 'Widgets')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('○ To Do')
    await clickOnceRedrawn(orcaPage, '○ To Do')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain(TODO_HEADING)
    await captureEveryWidth(electronApp, orcaPage, testInfo, 'panel-todo-added', TODO_HEADING)
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
