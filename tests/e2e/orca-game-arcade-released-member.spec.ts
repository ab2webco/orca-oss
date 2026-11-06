import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import {
  claudeVersionOk,
  screenRows,
  startGameBand,
  type GameBand
} from './helpers/orchestrator-game-band'

// ORCA-887: the lead and auto-release free a member right after its PR merges, so the lead's next
// `game state` has no member row, only the merge Orca recorded. It must still celebrate, once, and
// since ORCA-1053 open no pane: the host saves the play for the Team panel.
const WIDTHS = [1440, 768, 390, 320] as const
// The old offer's countdown line and pane title; neither may come back.
const OLD_OFFER = /\d{1,2}s to\s+choose|Arcade · unlocked/

const member = (number: number) => ({
  paneKey: `demo-wren-${number}`,
  displayName: 'Wren',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: { id: `demo-wt-${number}`, branch: `feat/lum-${number}`, displayName: `LUM-${number}` },
  review: {
    provider: 'github',
    number,
    title: 'Seats',
    url: `https://github.example.com/lumen/app/pull/${number}`,
    state: 'open',
    ci: 'success'
  }
})

const merge = (number: number) => ({
  key: `merged LUM-${number} #${number}`,
  ticket: `LUM-${number}`,
  provider: 'github',
  number,
  worktreeId: `demo-wt-${number}`,
  perfect: true
})

const gameState = (agents: unknown[], merges: unknown[]) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: { id: 'demo-wt-lead', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: true
    },
    ...agents
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en',
  merges
})

const screenOf = async (page: Page): Promise<string> => (await screenRows(page)).join(' ')

const showsOldOffer = async (page: Page): Promise<boolean> => OLD_OFFER.test(await screenOf(page))

/** The merges the mod has celebrated, from its store under the band's Claude config. */
async function offersOf(root: string): Promise<string[]> {
  const dir = join(root, 'claude-config', 'plugins', 'store')
  const files = await readdir(dir).catch(() => [])
  const stores = await Promise.all(
    files
      .filter((name) => name.startsWith('orca-game') && name.endsWith('.json'))
      .map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown)
  )
  return stores.flatMap((one) => {
    const offers = (one as Record<string, unknown>)['arcade-offers']
    return Array.isArray(offers) ? offers.map(String) : []
  })
}

// Why the 30 s poll and no Refresh click: the lead's cheer comes from its timer, not a click.
async function nextPoll(band: GameBand): Promise<void> {
  const before = await band.reads()
  await expect
    .poll(band.reads, { timeout: 45_000, intervals: [250], message: 'the mod never polled again' })
    .toBeGreaterThan(before)
}

for (const theme of ['light', 'dark'] as const) {
  test(`a member released before the next poll still celebrates once, with no pane (${theme})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(900_000)
    await waitForSessionReady(orcaPage)
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: gameState([], []),
      theme,
      locale: 'en',
      scene: 'quest'
    })
    try {
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the band never drew' })
        .toContain('Panel')
      const merges: unknown[] = []
      for (const [index, width] of WIDTHS.entries()) {
        await electronApp.evaluate(({ BrowserWindow }, size) => {
          const window_ = BrowserWindow.getAllWindows()[0]
          window_?.setMinimumSize(320, 400)
          window_?.setSize(size, 900)
        }, width)
        await expect.poll(async () => orcaPage.evaluate(() => window.innerWidth)).toBe(width)
        await orcaPage.evaluate(() => {
          window.__store!.getState().setSidebarOpen(false)
          window.__store!.getState().setRightSidebarOpen(false)
        })
        await orcaPage.waitForTimeout(1_500)

        // Each width merges a new PR, so its cheer is one the mod has not made yet.
        const number = 300 + index
        await band.setState(gameState([member(number)], merges))
        await nextPoll(band)

        // Released at once: the row is gone and only the recorded merge says it happened.
        merges.push(merge(number))
        await band.setState(gameState([], merges))
        await nextPoll(band)
        const id = `perfect-merge:github#${number}@demo-wt-${number}`
        await expect
          .poll(() => offersOf(band.root), { timeout: 10_000, message: `no cheer for #${number}` })
          .toContain(id)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`released-celebrate-${theme}-${width}.png`),
          animations: 'disabled'
        })
        expect(await showsOldOffer(orcaPage), `an offer pane for #${number}`).toBe(false)

        // The same merge read again celebrates nothing more.
        await nextPoll(band)
        expect((await offersOf(band.root)).filter((one) => one === id)).toHaveLength(1)
        expect(await showsOldOffer(orcaPage), `an offer pane for #${number}`).toBe(false)
      }
    } finally {
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
