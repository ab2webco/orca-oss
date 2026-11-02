import { rm } from 'node:fs/promises'
import type { Page } from '@stablyai/playwright-test'
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

// A lead's Panel with one launched member and two sessions no `game launch` started (ORCA-914):
// a codex and an opencode in plain worktrees. Each found one gets the same Team card as a member.
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const agent = (paneKey: string, overrides: Record<string, unknown>) => ({
  paneKey,
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...overrides
})

const gameState = {
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  sources: {},
  warnings: [],
  worktree: { id: 'lead-wt', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    agent('demo-lum-21', {
      displayName: 'Arthur · LUM-21',
      state: 'working',
      toolName: 'Edit',
      worktree: { id: 'wt-lum-21', branch: 'feat/lum-21', displayName: 'LUM-21' }
    }),
    agent('demo-found-codex', {
      displayName: 'Gawain',
      agentType: 'codex',
      worktree: { id: 'wt-gawain', branch: 'fix/seat-map', displayName: 'Gawain' },
      found: true
    }),
    agent('demo-found-opencode', {
      displayName: 'Percival',
      agentType: 'opencode',
      state: 'working',
      worktree: { id: 'wt-percival', branch: 'docs/notes', displayName: 'Percival' },
      found: true
    })
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
}

const screenText = async (page: Page) => (await screenRows(page)).join('\n')
const NAMES = [/Arthur/, /Gawain/, /Percival/]

/** Wheels a short docked Panel down until every card was on screen; returns all it read. */
async function scrollPanelThrough(page: Page, seen: string): Promise<string> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 30 && !NAMES.every((one) => one.test(seen)); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
    seen += `\n${await screenText(page)}`
  }
  return seen
}

test('the Panel lists sessions no game launch started beside launched members', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(900_000)
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: gameState,
    theme: 'dark',
    locale: 'en'
  })
  try {
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Arthur')
    await orcaPage.waitForTimeout(REDRAW_MS)
    await clickTerminalText(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('Gawain')

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(HOLD_MS)
        const shot = `panel-found-sessions-${theme}-${width}`
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${shot}.png`),
          animations: 'disabled'
        })
        let seen = await screenText(orcaPage)
        if (!NAMES.every((one) => one.test(seen))) {
          seen = await scrollPanelThrough(orcaPage, seen)
          await orcaPage.waitForTimeout(HOLD_MS)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${shot}-scrolled.png`),
            animations: 'disabled'
          })
          await orcaPage.mouse.wheel(0, -3_600)
        }
        for (const name of NAMES) {
          expect(seen, `${shot} drops ${name.source}`).toMatch(name)
        }
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
