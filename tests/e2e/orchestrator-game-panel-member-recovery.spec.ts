import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
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

// Why: after a paired host restarted, its members slept and the Panel offered nothing to bring them
// back; a lost link left a member just as stuck. Their cards now carry Resume and Reconnect (ORCA-915).
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const member = (
  paneKey: string,
  ticket: string,
  name: string,
  remote: { host: string; stateKnown: boolean; asleep?: true }
) => ({
  paneKey,
  displayName: `${name} · ${ticket}`,
  agentType: '',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: `term_${ticket.replace('-', '_').toLowerCase()}`,
  worktree: { id: `wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket },
  remote
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
    member('remote:ctx_14', 'LUM-14', 'Arthur', { host: 'imac', stateKnown: true }),
    member('remote:ctx_15', 'LUM-15', 'Merlin', { host: 'imac', stateKnown: true, asleep: true }),
    member('remote:ctx_17', 'LUM-17', 'Morgana', { host: 'linux', stateKnown: false })
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
// Why either: a narrow card shortens the tag to `imac asleep`, and a phone draws `▸ Resume` chips.
const ASLEEP = /asleep on imac|imac asleep/
const TARGETS = [ASLEEP, /Resume/, /Reconnect/, /\bLUM-17\b/]

/** Wheels a short docked Panel down until every target was on screen; returns all it read. */
async function scrollPanelThrough(page: Page, seen: string): Promise<string> {
  const point = await terminalPointOf(page, '✕')
  expect(point, 'the Panel is not on screen').not.toBeNull()
  await page.mouse.move(point!.x, point!.y)
  for (let step = 0; step < 30 && !TARGETS.every((one) => one.test(seen)); step++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
    seen += `\n${await screenText(page)}`
  }
  return seen
}

test('the Panel offers Resume for a member its host slept and Reconnect for a silent host', async ({
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
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(ASLEEP)
    const wide = await screenText(orcaPage)
    expect(wide).toContain(' Resume ')
    expect(wide).toContain(' Reconnect ')
    // The live member keeps View: only a slept or unreachable one changes its action.
    expect(wide).toContain(' View ')

    // Resume asks Orca to wake exactly that member, through the CLI the mod was handed.
    const log = join(band.root, 'reads.log')
    const resumeCalled = async () =>
      (await readFile(log, 'utf8'))
        .split('\n')
        .includes('game resume-members --tickets LUM-15 --json')
    // Why retry: a click that lands while the Panel redraws only focuses the button.
    for (let attempt = 0; attempt < 3 && !(await resumeCalled()); attempt++) {
      await clickTerminalText(orcaPage, 'Resume')
      await expect
        .poll(resumeCalled, { timeout: 8_000 })
        .toBe(true)
        .catch(() => undefined)
    }
    expect(await resumeCalled(), 'Resume never asked Orca to wake LUM-15').toBe(true)
    // The demo CLI wakes nothing, so the toast must say so rather than claim the member woke.
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toContain('Could not resume Merlin · LUM-15')

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(HOLD_MS)
        const shot = `panel-recovery-${theme}-${width}`
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${shot}.png`),
          animations: 'disabled'
        })
        let seen = await screenText(orcaPage)
        if (!TARGETS.every((one) => one.test(seen))) {
          seen = await scrollPanelThrough(orcaPage, seen)
          await orcaPage.waitForTimeout(HOLD_MS)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${shot}-scrolled.png`),
            animations: 'disabled'
          })
          await orcaPage.mouse.wheel(0, -3_600)
        }
        for (const target of TARGETS) {
          expect(seen, `${shot} drops ${target}`).toMatch(target)
        }
      }
    }
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
