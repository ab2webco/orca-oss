import { rm } from 'node:fs/promises'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { setWindowWidth, WIDTHS } from './helpers/settings-window'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'

// The lead and members are invented; `game watch` is the helper's stand-in for Orca's push.
const HOLD_MS = 1_500
// Why 2 s: ORCA-889's bar for a launch or release reaching the band with no manual refresh.
const PUSH_BUDGET_MS = 2_000

const member = (name: string, ticket: string) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: name,
  agentType: 'claude',
  state: 'working',
  toolName: 'Edit',
  isLeader: false,
  isMember: true,
  worktree: { id: `demo-wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket }
})

const gameState = (members: object[]) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: { id: 'demo-wt-lead', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    ...members
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
})

const content = (page: Page) => () => getTerminalContent(page, 20_000)

// Why: a late startup write can reopen a sidebar and squeeze the terminal.
async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

for (const theme of ['dark', 'light'] as const) {
  test(`the band follows a pushed fleet change within 2 s and ages a fleet it cannot read (${theme})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(300_000)
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0])
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: gameState([member('Wren', 'LUM-12')]),
      theme,
      locale: 'en'
    })
    const shoot = async (name: string): Promise<void> => {
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await closeSidebars(orcaPage)
        await orcaPage.waitForTimeout(HOLD_MS)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${name}-${theme}-${width}.png`),
          animations: 'disabled'
        })
      }
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0])
    }
    try {
      await expect
        .poll(content(orcaPage), { timeout: 60_000, message: 'the band never drew the lead' })
        .toContain('1 working')
      // Why wait: the watch's own `ready` read must be over, so the next read is the push's.
      await orcaPage.waitForTimeout(HOLD_MS)
      const before = await band.reads()

      // A member launches: Orca pushes, nobody presses Refresh, no turn ends, no 30 s poll.
      await band.setState(gameState([member('Wren', 'LUM-12'), member('Pico', 'LUM-14')]))
      const pushedAt = Date.now()
      await band.pushFleetChange(2)
      await expect
        .poll(content(orcaPage), { timeout: PUSH_BUDGET_MS, intervals: [100] })
        .toContain('2 working')
      testInfo.annotations.push({
        type: 'push-to-band-ms',
        description: `${Date.now() - pushedAt}`
      })
      expect(await band.reads()).toBe(before + 1)
      await shoot('pushed')

      // Orca stops answering: the band keeps both members and says how old they are.
      await band.failReads()
      await band.pushFleetChange(3)
      await expect.poll(content(orcaPage), { timeout: 10_000 }).toMatch(/updated \d+ s ago/)
      expect(await content(orcaPage)()).toContain('2 working')
      await shoot('stale')
    } finally {
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
