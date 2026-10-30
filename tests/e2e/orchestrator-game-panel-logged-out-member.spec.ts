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

// A lead with a member whose account logged out (ORCA-907) beside one stopped on a usage limit:
// the first needs a person to log it in again, the second only waits for its reset.
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const member = (ticket: string, name: string, email: string, limit: Record<string, unknown>) => ({
  paneKey: `demo-${ticket}`,
  displayName: `${name} · ${ticket}`,
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: { id: `wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket },
  account: { provider: 'claude', id: `acct-${name.toLowerCase()}`, email },
  limit
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
    member('LUM-21', 'Arthur', 'scloud@netsat.co', { resetsAt: null, loggedOut: true }),
    member('LUM-22', 'Merlin', 'ana@koombea.com', { resetsAt: null })
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
// Why a prefix: a phone-width card ellipsizes the tag after its first words.
const LOGGED_OUT = /logged out/
const LIMITED = /\blimited\b/
const SCROLL_TARGETS = [LOGGED_OUT, LIMITED]

/** Wheels a short docked Panel down until both tags were on screen; returns all it read. */
async function scrollPanelThrough(page: Page, seen: string): Promise<string> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 30 && !SCROLL_TARGETS.every((one) => one.test(seen)); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
    seen += `\n${await screenText(page)}`
  }
  return seen
}

test('the Panel says a member whose account logged out needs /login, apart from a limited one', async ({
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
      .toContain('Merlin')
    await orcaPage.waitForTimeout(REDRAW_MS)
    await clickTerminalText(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toContain('logged out · /login in its pane')
    expect(await screenText(orcaPage)).toMatch(LIMITED)
    // Why: the member's hooks say idle, yet it waits on a person to log it in again.
    expect(await screenText(orcaPage)).toContain('1 waiting on you')

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(HOLD_MS)
        const shot = `panel-logged-out-${theme}-${width}`
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${shot}.png`),
          animations: 'disabled'
        })
        let seen = await screenText(orcaPage)
        if (!SCROLL_TARGETS.every((one) => one.test(seen))) {
          seen = await scrollPanelThrough(orcaPage, seen)
          await orcaPage.waitForTimeout(HOLD_MS)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${shot}-scrolled.png`),
            animations: 'disabled'
          })
          await orcaPage.mouse.wheel(0, -3_600)
        }
        expect(seen, `${shot} drops the logged-out tag`).toMatch(LOGGED_OUT)
        expect(seen, `${shot} drops the limited tag`).toMatch(LIMITED)
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
