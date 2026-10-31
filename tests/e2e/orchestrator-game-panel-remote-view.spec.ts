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

// View on a remote member used to focus its host's handle locally and always fail (ORCA-790).
const HOLD_MS = 1_500
const REDRAW_MS = 1_000

const remoteMember = (
  ticket: string,
  dispatch: string,
  remote: { host: string; stateKnown: boolean; gone?: true; environmentId?: string }
) => ({
  paneKey: `remote:${dispatch}`,
  displayName: ticket,
  agentType: '',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: `term_${dispatch}`,
  remote
})

const stateWith = (member: ReturnType<typeof remoteMember>) => ({
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
    member
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
})

const GONE = remoteMember('LUM-16', 'ctx_16', { host: 'imac', stateKnown: false, gone: true })
const CASES = [
  { member: GONE, toast: 'LUM-16 no longer' },
  {
    member: remoteMember('LUM-15', 'ctx_15', { host: 'imac', stateKnown: false }),
    toast: 'imac does not answer'
  },
  {
    member: remoteMember('LUM-14', 'ctx_14', { host: 'imac', stateKnown: true }),
    toast: 'LUM-14 runs on imac'
  },
  // Why: this CLI refuses the open, so the mod must say so and how to read the member (ORCA-839).
  {
    member: remoteMember('LUM-13', 'ctx_13', {
      host: 'imac',
      stateKnown: true,
      environmentId: 'env-imac'
    }),
    toast: 'Could not open LUM-13'
  }
]

const UNOPENED = CASES.at(-1)!.member

const screenText = async (page: Page) => (await screenRows(page)).join('\n')

// Why not 'View': the menu's `View: 2D hd` chip is drawn below the card and would be hit first.
const viewPointOf = async (page: Page) =>
  (await terminalPointOf(page, '▸ View')) ?? (await terminalPointOf(page, 'View '))

/** The member's View, wheeling a short docked Panel down to it when a phone width hides it. */
async function memberViewPointOf(page: Page): Promise<{ x: number; y: number } | null> {
  // Why ✕: only the Panel's Close chip draws it; the band below repeats the other labels.
  const close = await terminalPointOf(page, '✕')
  for (let step = 0; step < 30 && !(await viewPointOf(page)) && close; step++) {
    await page.mouse.move(close.x, close.y)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(250)
  }
  return viewPointOf(page)
}

/** Clicks the member's View until its toast's first words show; the toast box wraps the rest. */
async function viewAndExpectToast(page: Page, toast: string): Promise<void> {
  // Why retry: a click that lands while the Panel redraws only focuses the button.
  for (let attempt = 0; attempt < 3; attempt++) {
    const point = await memberViewPointOf(page)
    expect(point, 'no member View on screen').not.toBeNull()
    await page.mouse.click(point!.x, point!.y)
    const shown = await expect
      .poll(async () => screenText(page), { timeout: 3_000, intervals: [100] })
      .toContain(toast)
      .then(() => true)
      .catch(() => false)
    if (shown) {
      return
    }
  }
  throw new Error(`no "${toast}" toast after three clicks on View`)
}

test('View on a remote member says where it is instead of failing to open it', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(900_000)
  await waitForSessionReady(orcaPage)
  await setWindowWidth(electronApp, orcaPage, 1440)
  const band = await startGameBand(orcaPage, testRepoPath, {
    // Why live: since ORCA-886 the band leaves a ghost (gone or silent) to its +N, never by name.
    state: stateWith(UNOPENED),
    theme: 'dark',
    locale: 'en'
  })
  try {
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('LUM-13')
    await orcaPage.waitForTimeout(REDRAW_MS)
    await clickTerminalText(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('View')

    for (const { member, toast } of CASES) {
      await band.setState(stateWith(member))
      await clickTerminalText(orcaPage, 'Refresh')
      await expect
        .poll(async () => screenText(orcaPage), { timeout: 20_000 })
        .toContain(member.displayName)
      await orcaPage.waitForTimeout(HOLD_MS)
      await viewAndExpectToast(orcaPage, toast)
      if (!member.remote.gone) {
        // Why: the toast's command must carry the dispatch id as typed, underscore included.
        expect(await screenText(orcaPage)).toContain(`${member.paneKey.replace('remote:', '')}`)
      }
      await orcaPage.screenshot({
        path: testInfo.outputPath(`remote-view-${member.displayName}-dark-1440.png`),
        animations: 'disabled'
      })
      await orcaPage.waitForTimeout(HOLD_MS)
    }

    await band.setState(stateWith(UNOPENED))
    await clickTerminalText(orcaPage, 'Refresh')
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(HOLD_MS)
        await viewAndExpectToast(orcaPage, 'Could not open LUM-13')
        await orcaPage.screenshot({
          path: testInfo.outputPath(`remote-view-unopened-${theme}-${width}.png`),
          animations: 'disabled'
        })
        await orcaPage.waitForTimeout(HOLD_MS)
      }
    }
    // Why: only the member with a pairing opens through it; none focuses the host's handle locally.
    const focuses = (await readFile(join(band.root, 'reads.log'), 'utf8'))
      .split('\n')
      .filter((line) => line.startsWith('terminal focus'))
    expect(focuses.length).toBeGreaterThan(0)
    expect(new Set(focuses)).toEqual(
      new Set(['terminal focus --terminal term_ctx_13 --on env-imac --json'])
    )
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
