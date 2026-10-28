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

// A lead with one local member and three on a paired host: one live, one whose host does not answer
// (ORCA-824), and one finished whose terminal closed while its host answers (ORCA-854).
// The local and one remote member carry roster names from the same pool (ORCA-794).
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const member = (
  paneKey: string,
  ticket: string,
  state: 'working' | 'idle' | 'done',
  remote: { host: string; stateKnown: boolean; gone?: true } | null,
  name: string | null = null
) => ({
  paneKey,
  displayName: name ? `${name} · ${ticket}` : ticket,
  agentType: remote ? '' : 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: { id: `wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket },
  ...(remote ? { remote } : {})
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
    member('demo-local', 'LUM-12', 'working', null, 'Arthur'),
    member('remote:ctx_14', 'LUM-14', 'working', { host: 'imac', stateKnown: true }, 'Merlin'),
    member('remote:ctx_15', 'LUM-15', 'idle', { host: 'imac', stateKnown: false }),
    member('remote:ctx_16', 'LUM-16', 'done', { host: 'imac', stateKnown: true, gone: true })
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
const SILENT_HOST = 'imac not answering'
// Why either: a phone-width card shortens the tag to `imac ?` rather than ellipsize it.
const SILENT_HOST_ANY = /imac (not answering|\?)/
// Why: a finished member's closed terminal must not read as gone or as a silent host (ORCA-854).
const CLOSED_AS_GONE = /gone from imac|imac ✕/
const TICKETS = ['LUM-12', 'LUM-14', 'LUM-15', 'LUM-16'] as const
const NAMES = ['Arthur', 'Merlin'] as const

// Why both: the silent host's card and the last one, the finished member's, must each be read.
const SCROLL_TARGETS = [SILENT_HOST_ANY, /\bLUM-16\b/]

/** Wheels a short docked Panel down until every target was on screen; returns all it read. */
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
  for (const target of SCROLL_TARGETS) {
    expect(seen).toMatch(target)
  }
  return seen
}

test('the Panel names the paired host of a remote member, and says only a silent one does not answer', async ({
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
      // Why a name: the band cuts a named member to `Merlin · …`, dropping its ticket.
      .toContain('Merlin')
    await orcaPage.waitForTimeout(REDRAW_MS)
    await clickTerminalText(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('on imac')
    expect(await screenText(orcaPage)).toContain(SILENT_HOST)

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(HOLD_MS)
        const shot = `panel-remote-${theme}-${width}`
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
        // ORCA-827: a phone-width card cut the ticket to `LU…` behind its sprite.
        for (const ticket of TICKETS) {
          expect(seen, `${shot} drops ${ticket}`).toMatch(new RegExp(`\\b${ticket}\\b`))
        }
        for (const name of NAMES) {
          expect(seen, `${shot} drops ${name}`).toContain(name)
        }
        expect(seen, `${shot} calls a finished member gone`).not.toMatch(CLOSED_AS_GONE)
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
