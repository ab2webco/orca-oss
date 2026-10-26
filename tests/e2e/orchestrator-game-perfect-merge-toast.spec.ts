import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import type { Page } from '@stablyai/playwright-test'
import {
  claudeVersionOk,
  clickTerminalText,
  screenRows,
  startGameBand,
  type GameBand
} from './helpers/orchestrator-game-band'

// ORCA-686: the band toasts a perfect merge only for a review the host marked
// `perfectMerge: true`; a merge marked false or with the decision absent earns none.
const WIDTHS = [1440, 768, 390, 320] as const
const RUNS = [
  // `cue` is the toast's first row; a narrow window wraps the rest. The band's loading
  // chip is a bare ↻ too, so Refresh is clicked by its word.
  { theme: 'dark', locale: 'en', refresh: 'Refresh', cue: (label: string) => `${label} perfect` },
  { theme: 'light', locale: 'en', refresh: 'Refresh', cue: (label: string) => `${label} perfect` },
  { theme: 'dark', locale: 'es', refresh: 'Actualizar', cue: (label: string) => `${label}: merge` }
] as const

type Decision = boolean | undefined

const member = (
  name: string,
  ticket: string,
  number: number,
  merged: boolean,
  perfect: Decision
) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: name,
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: {
    id: `demo-wt-${ticket}`,
    branch: `feat/${ticket.toLowerCase()}`,
    displayName: ticket
  },
  workItem: {
    provider: 'plane',
    identifier: ticket,
    title: `${ticket} work`,
    url: `https://plane.example.com/lumen/browse/${ticket}/`,
    status: 'In Review',
    statusGroup: 'review'
  },
  review: {
    provider: 'github',
    number,
    title: `${ticket} work`,
    url: `https://github.example.com/lumen/app/pull/${number}`,
    state: merged ? 'merged' : 'open',
    ci: 'success',
    ...(merged && perfect !== undefined ? { perfectMerge: perfect } : {})
  }
})

// Each round uses new PR numbers, so its rewards are new ids the ledger has not seen.
const numbersOf = (round: number) => ({
  wren: 100 + round * 10 + 1,
  pico: 100 + round * 10 + 2,
  juno: 100 + round * 10 + 3
})

type Step = 'open' | 'others-merged' | 'all-merged'

const gameState = (round: number, step: Step, locale: string) => {
  const numbers = numbersOf(round)
  const othersMerged = step !== 'open'
  const junoMerged = step === 'all-merged'
  return {
    config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
    warnings: [],
    worktree: {
      id: 'demo-wt-lead',
      path: '/work/lumen-app',
      branch: 'main',
      displayName: 'lumen-app'
    },
    agents: [
      {
        paneKey: 'demo-atlas',
        displayName: 'Atlas',
        agentType: 'claude',
        state: 'idle',
        toolName: null,
        isLeader: true
      },
      member('Wren', 'LUM-12', numbers.wren, othersMerged, false),
      member('Pico', 'LUM-14', numbers.pico, othersMerged, undefined),
      member('Juno', 'LUM-15', numbers.juno, junoMerged, true)
    ],
    review: null,
    workItem: null,
    extensions: { scenes: [] },
    links: [],
    activity: null,
    role: 'lead',
    locale
  }
}

/** Every reward id the mod has written anywhere under its Claude config. */
async function awardedIds(root: string): Promise<string> {
  const files = await readdir(join(root, 'claude-config'), { recursive: true, withFileTypes: true })
  const texts = await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8').catch(() => ''))
  )
  return texts.join('\n')
}

/** Clicks the band's Refresh until the mod reads again; a click during a refresh is dropped. */
async function refreshUntilRead(page: Page, band: GameBand, label: string): Promise<void> {
  const before = await band.reads()
  for (let attempt = 0; attempt < 10; attempt++) {
    await clickTerminalText(page, label)
    try {
      await expect.poll(band.reads, { timeout: 3_000, intervals: [100] }).toBeGreaterThan(before)
      return
    } catch {
      // The click landed during a refresh; click again.
    }
  }
  throw new Error('Refresh never made the mod read again')
}

for (const run of RUNS) {
  test(`the band toasts a perfect merge only when the host decided one (${run.theme}, ${run.locale})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(300_000)
    await waitForSessionReady(orcaPage)
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: gameState(0, 'open', run.locale),
      theme: run.theme,
      locale: run.locale
    })
    try {
      await expect
        .poll(async () => getTerminalContent(orcaPage, 20_000), {
          timeout: 60_000,
          message: 'the band never drew the seeded party'
        })
        .toContain('Juno')

      for (const [index, width] of WIDTHS.entries()) {
        const round = index + 1
        await electronApp.evaluate(({ BrowserWindow }, size) => {
          const window_ = BrowserWindow.getAllWindows()[0]
          window_?.setMinimumSize(320, 400)
          window_?.setSize(size, 900)
        }, width)
        await expect.poll(async () => orcaPage.evaluate(() => window.innerWidth)).toBe(width)
        await orcaPage.waitForTimeout(1_500)

        // Why one read per step: Claude Code drops a toast when four arrive in one frame.
        for (const step of ['open', 'others-merged', 'all-merged'] as const) {
          await band.setState(gameState(round, step, run.locale))
          await refreshUntilRead(orcaPage, band, run.refresh)
        }
        const numbers = numbersOf(round)
        const toast = `LUM-15 · ${run.cue(`#${numbers.juno}`)}`
        await expect
          .poll(async () => (await screenRows(orcaPage)).some((row) => row.includes(toast)), {
            timeout: 10_000,
            intervals: [100],
            message: `no "${toast}" toast at ${width}`
          })
          .toBe(true)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${run.theme}-${run.locale}-${width}.png`),
          animations: 'disabled'
        })

        const ids = await awardedIds(band.root)
        expect(ids).toContain(`perfect-merge:github#${numbers.juno}@`)
        expect(ids).toContain(`review-merged:github#${numbers.wren}@`)
        expect(ids).toContain(`review-merged:github#${numbers.pico}@`)
        expect(ids).not.toContain(`perfect-merge:github#${numbers.wren}@`)
        expect(ids).not.toContain(`perfect-merge:github#${numbers.pico}@`)
      }
    } finally {
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
