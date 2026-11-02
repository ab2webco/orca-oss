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

// ORCA-933: three members on a paired host, as the home fills them from the host's relay: one whose
// Jev reported, one without Jev whose own hooks named its model, and one with only its launch model.
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const remoteMember = (ticket: string, extra: Record<string, unknown>) => ({
  paneKey: `remote:ctx_${ticket}`,
  displayName: ticket,
  agentType: 'claude',
  state: 'working',
  toolName: 'Bash',
  isLeader: false,
  isMember: true,
  worktree: { id: `wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket },
  remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true },
  ...extra
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
    remoteMember('LUM-31', {
      advisor: { model: 'Opus 5.5', effort: 'medium', pinned: { model: false, effort: false } },
      launch: { model: 'Opus 5.5', effort: 'high', source: 'session' }
    }),
    remoteMember('LUM-32', { launch: { model: 'Sonnet 5.5', effort: 'low', source: 'session' } }),
    remoteMember('LUM-33', { launch: { model: 'Haiku 5.5', effort: 'high', source: 'launch' } })
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
// Why these: each member's model row names its source, so a missing Jev never reads as no model.
const MODEL_ROWS = [
  /◆ (Jev )?Opus 5\.5·medium/,
  /◇ session Sonnet 5\.5·low/,
  /◇ launch Haiku 5\.5·high/
]

/** Wheels a short docked Panel down until every model row was on screen; returns all it read. */
async function scrollPanelThrough(page: Page, seen: string): Promise<string> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 30 && !MODEL_ROWS.every((one) => one.test(seen)); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
    seen += `\n${await screenText(page)}`
  }
  return seen
}

test("the Panel shows a remote member's tool and model, and whose word the model is", async ({
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
      .toContain('LUM-31')
    await orcaPage.waitForTimeout(REDRAW_MS)
    await clickTerminalText(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(HOLD_MS)
        const shot = `panel-remote-models-${theme}-${width}`
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${shot}.png`),
          animations: 'disabled'
        })
        let seen = await screenText(orcaPage)
        if (!MODEL_ROWS.every((one) => one.test(seen))) {
          seen = await scrollPanelThrough(orcaPage, seen)
          await orcaPage.waitForTimeout(HOLD_MS)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${shot}-scrolled.png`),
            animations: 'disabled'
          })
          await orcaPage.mouse.wheel(0, -3_600)
        }
        for (const row of MODEL_ROWS) {
          expect(seen, `${shot} drops ${row}`).toMatch(row)
        }
        // Why: the relayed toolName must read as the local member's activity does (ORCA-933).
        expect(seen, `${shot} drops the remote member's activity`).toContain('Running a command')
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
