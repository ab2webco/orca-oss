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

// A lead with members here and on a paired iMac short of memory, and a silent m1 (ORCA-841).
const HOLD_MS = 1_500
const REDRAW_MS = 1_000
const GB = 1024 ** 3

const member = (paneKey: string, ticket: string, host: string | null) => ({
  paneKey,
  displayName: ticket,
  agentType: host ? '' : 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: { id: `wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket },
  ...(host ? { remote: { host, stateKnown: true } } : {})
})

const machine = (cores: number, total: number, free: number, load: number) => ({
  status: 'ok',
  cpuCoreCount: cores,
  totalMemory: total * GB,
  availableMemory: free * GB,
  loadAverage1m: load
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
    member('demo-local', 'LUM-12', null),
    member('remote:ctx_14', 'LUM-14', 'imac'),
    member('remote:ctx_15', 'LUM-15', 'imac')
  ],
  hostCapacity: [
    { host: 'local', running: 1, ...machine(10, 16, 9, 2.1) },
    { host: 'imac', running: 2, ...machine(4, 52, 4.9, 3.8) },
    { host: 'm1', running: 0, status: 'unreachable' }
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

// Why either form: a phone-width Panel draws each host as marks instead of words.
const HOST_LINES = [
  /⌂ local (1 running · 10 cores · 9\.0 of 16 GB free · load 2\.1|1▸ 10c 9\.0\/16G L2\.1)/,
  /⌂ imac (2 running · 4 cores · 4\.9 of 52 GB free · load 3\.8 · low memory|2▸ 4c 4\.9\/52G L3\.8 !mem)/,
  /⌂ m1 (0 running · not answering|0▸ \?)/
]

/** Wheels a short docked Panel down until every host line was on screen; returns all it read. */
async function scrollPanelThrough(page: Page, seen: string): Promise<string> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 30 && !HOST_LINES.every((one) => one.test(seen)); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
    seen += `\n${await screenText(page)}`
  }
  return seen
}

test('the Panel lists each host with its members, cores, free memory and load', async ({
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
      .toContain('LUM-14')
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
        const shot = `panel-hosts-${theme}-${width}`
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${shot}.png`),
          animations: 'disabled'
        })
        let seen = await screenText(orcaPage)
        if (!HOST_LINES.every((one) => one.test(seen))) {
          seen = await scrollPanelThrough(orcaPage, seen)
          await orcaPage.waitForTimeout(HOLD_MS)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${shot}-scrolled.png`),
            animations: 'disabled'
          })
          await orcaPage.mouse.wheel(0, -3_600)
        }
        await testInfo.attach(`${shot}.txt`, { body: seen, contentType: 'text/plain' })
        for (const line of HOST_LINES) {
          expect(seen, `${shot} drops ${line}`).toMatch(line)
        }
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
