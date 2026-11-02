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
// `game state` has no member row, only the merge Orca recorded. The offer must still open, once.
const WIDTHS = [1440, 768, 390, 320] as const
// Why only here: a poll's offer does not show below this yet (ORCA-893); the store proves it fired.
const SHOWN_FROM = 1440
const SECONDS_LEFT = /(\d{1,2})s to\s+choose/

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

const secondsLeftOf = async (page: Page): Promise<number | undefined> => {
  const found = SECONDS_LEFT.exec(await screenOf(page))
  return found === null ? undefined : Number(found[1])
}

/** The offers the mod has made, from its store under the band's Claude config. */
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

// Why the 30 s poll and no Refresh click: the lead's offer comes from its timer, not a click.
async function nextPoll(band: GameBand): Promise<void> {
  const before = await band.reads()
  await expect
    .poll(band.reads, { timeout: 45_000, intervals: [250], message: 'the mod never polled again' })
    .toBeGreaterThan(before)
}

for (const theme of ['light', 'dark'] as const) {
  test(`a member released before the next poll still unlocks the arcade once (${theme})`, async ({
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

        // Each width merges a new PR, so its offer is one the mod has not made yet.
        const number = 300 + index
        await band.setState(gameState([member(number)], merges))
        await nextPoll(band)
        expect(await secondsLeftOf(orcaPage), `no offer while #${number} is open`).toBeUndefined()

        // Released at once: the row is gone and only the recorded merge says it happened.
        merges.push(merge(number))
        await band.setState(gameState([], merges))
        await nextPoll(band)
        const id = `perfect-merge:github#${number}@demo-wt-${number}`
        await expect
          .poll(() => offersOf(band.root), { timeout: 10_000, message: `no offer for #${number}` })
          .toContain(id)
        if (width >= SHOWN_FROM) {
          await expect
            .poll(() => secondsLeftOf(orcaPage), {
              timeout: 30_000,
              message: `the offer for #${number} never showed at ${width}px`
            })
            .toBeDefined()
        }
        await orcaPage.screenshot({
          path: testInfo.outputPath(`released-offer-${theme}-${width}.png`),
          animations: 'disabled'
        })
        await expect
          .poll(() => secondsLeftOf(orcaPage), {
            timeout: 40_000,
            message: `the offer never closed at ${width}px`
          })
          .toBeUndefined()

        // The same merge read again offers nothing more.
        await nextPoll(band)
        expect((await offersOf(band.root)).filter((one) => one === id)).toHaveLength(1)
        expect(await secondsLeftOf(orcaPage), `a second offer for #${number}`).toBeUndefined()
      }
    } finally {
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
