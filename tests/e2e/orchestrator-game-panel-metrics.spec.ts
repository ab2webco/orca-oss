import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { setWindowWidth } from './helpers/settings-window'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import {
  captureEveryWidth,
  clickOnceRedrawn,
  screenText
} from './helpers/orchestrator-game-panel-capture'
import { parseGameEvent } from '../../src/shared/orchestrator-game-events'
import { parseGameHistoryRecord } from '../../src/shared/orchestrator-game-history'
import { gameMetricsSummaryOf } from '../../src/shared/orchestrator-game-metrics-summary'

const METRICS_HEADING = '▾ Metrics'
// Why the last account: scrolling to it brings the whole widget into a short docked Panel.
const METRICS_LAST_ROW = 'spare@example.com'

// Why recorded: the summary the host would send for this project's real stores on 2026-10-30.
const recorded = JSON.parse(
  readFileSync(
    join(__dirname, '../../src/shared/__fixtures__/orchestrator-game-recorded-stores.json'),
    'utf8'
  )
) as { recordedAt: string; events: unknown[]; history: unknown[] }
const metrics = {
  ...gameMetricsSummaryOf(
    {
      events: recorded.events.map(parseGameEvent).filter((one) => one !== null),
      history: recorded.history.map(parseGameHistoryRecord).filter((one) => one !== null)
    },
    { now: Date.parse(recorded.recordedAt), timezone: 'America/Bogota' }
  ),
  // The recording blanks accounts; these show one meter calm and one near its limit.
  claudeAccounts: [
    { email: 'lead@example.com', active: true, sessionPercent: 41, weeklyPercent: 63 },
    { email: 'spare@example.com', active: false, sessionPercent: null, weeklyPercent: 92 }
  ]
}

const gameState = {
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  sources: {},
  warnings: [],
  worktree: { id: 'metrics-wt', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
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
      isMember: true
    }
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  metrics,
  role: 'lead',
  locale: 'en'
}

test("the Metrics widget draws the lead's merges per day, lead time and accounts", async ({
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
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Wren')
    await clickOnceRedrawn(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')
    await clickOnceRedrawn(orcaPage, 'Widgets')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('○ Metrics')
    await clickOnceRedrawn(orcaPage, '○ Metrics')
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toContain(METRICS_HEADING)
    const total = metrics.mergedPerDay.reduce((sum, one) => sum + one.merged, 0)
    expect(await screenText(orcaPage)).toContain(`${total} merged · 14 days`)
    await captureEveryWidth(electronApp, orcaPage, testInfo, 'panel-metrics', METRICS_LAST_ROW)
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
