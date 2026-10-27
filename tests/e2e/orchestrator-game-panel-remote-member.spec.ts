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

// A lead with one local member and two on a paired host, one of which does not answer (ORCA-824).
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const member = (
  paneKey: string,
  ticket: string,
  state: 'working' | 'idle',
  remote: { host: string; stateKnown: boolean } | null
) => ({
  paneKey,
  displayName: ticket,
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
    member('demo-local', 'LUM-12', 'working', null),
    member('remote:ctx_14', 'LUM-14', 'working', { host: 'imac', stateKnown: true }),
    member('remote:ctx_15', 'LUM-15', 'idle', { host: 'imac', stateKnown: false })
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

/** Wheels a short docked Panel down until the silent host's card is on screen. */
async function scrollPanelTo(page: Page, text: RegExp): Promise<void> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 30 && !text.test(await screenText(page)); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
  }
  expect(await screenText(page)).toMatch(text)
}

test('the Panel names the paired host of a remote member, and says when it does not answer', async ({
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
      .toContain('LUM-12')
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
        if (!SILENT_HOST_ANY.test(await screenText(orcaPage))) {
          await scrollPanelTo(orcaPage, SILENT_HOST_ANY)
          await orcaPage.waitForTimeout(HOLD_MS)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${shot}-scrolled.png`),
            animations: 'disabled'
          })
          await orcaPage.mouse.wheel(0, -3_600)
        }
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
