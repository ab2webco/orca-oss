import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { waitForRuntimeWorktree } from './helpers/game-cycle-contract'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'

const WIDTHS = [1440, 768, 390, 320]
const MEMBER = 'Merlín · ORCA-12 Keep the look'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// ORCA-1094 rows 1, 2 and 6: with no Lead name the lead is a character, a member's tab reads
// `name · ticket · host`, and the header levels the team from its characters' real XP plus the
// rewards the mod reported (ORCA-1264).
test('the lead is a character, the member tab names who runs, and XP comes from the characters', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    await writeSettings(orcaPage, {
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
    // Why a foreground process: a lead pane back at its shell is not a live lead.
    await client.call('terminal.send', {
      terminal: lead,
      text: 'node -e "setInterval(() => {}, 1e9)"',
      enter: true
    })
    await expect
      .poll(
        async () =>
          (
            await client.call<{ registered: boolean }>('game.leadRegister', {
              terminalHandle: lead,
              project: 'e2e',
              // Why harmless: the register's label names the mail sender, not the lead card.
              label: 'Alfred'
            })
          ).result.registered
      )
      .toBe(true)
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Lead defaults',
      from: lead
    })
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-12',
      taskTitle: MEMBER,
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    // Why: right after launch the runtime's worktree scan may not list the lead's worktree yet (ORCA-1145).
    await waitForRuntimeWorktree(client, worktreeId)
    await client.call('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${worktreeId}`,
      displayName: MEMBER,
      agent: 'codex',
      timeoutMs: 20_000
    })

    // Row 6: the member's tab names its character, ticket and host, not `worker-task_…`.
    // ORCA-1149: the stored title keeps `local`; only the label names this machine.
    const memberTab = orcaPage.locator(
      '[data-testid="sortable-tab"][data-tab-title="Merlín · ORCA-12 · local"]'
    )
    await expect(memberTab.first()).toContainText('Merlín · ORCA-12 · This computer', {
      timeout: 60_000
    })
    await expect(orcaPage.getByText(/worker-task_/)).toHaveCount(0)

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const leadCard = panel.locator('[data-team-card="lead"]')
    // Row 1: no Lead name, so the quest roster's last character, never the worktree's name.
    await expect(leadCard).toContainText('Elaine', { timeout: 90_000 })
    await expect(leadCard).not.toContainText(/^(main|master)/)

    // Row 2: a merged task pays its character 100 XP, the real path `orca game free` takes.
    const xp = panel.locator('[data-team-xp]')
    const level = xp.locator('[data-team-xp-level]')
    // Why exact: '190 XP to Lv 3' contains '90 XP to Lv 3'.
    const left = xp.locator('[data-team-xp-left]')
    await expect(level).toHaveText('Lv 1', { timeout: 60_000 })
    await expect(left).toHaveText('100 XP to Lv 2')
    await client.call('game.historyRecord', {
      worktreeId,
      terminalHandle: lead,
      record: {
        ticket: 'ORCA-12',
        outcome: 'merged',
        endedAt: new Date().toISOString(),
        pr: 'https://github.com/o/r/pull/12'
      },
      character: 'Merlín',
      characterKey: 'merlin'
    })
    const characters = await client.call<{ characters: { key: string; xp: number }[] }>(
      'game.characters',
      { worktreeId, terminalHandle: lead }
    )
    expect(characters.result.characters).toEqual([expect.objectContaining({ xp: 100 })])
    await expect(level).toHaveText('Lv 2', { timeout: 60_000 })
    await expect(left).toHaveText('200 XP to Lv 3')

    // ORCA-1264: a reward the mod toasts moves the bar by its XP, on top of the characters'.
    await client.call('game.xp', {
      worktreeId,
      terminalHandle: lead,
      rewards: [
        { id: 'member-claimed:wt-12', kind: 'member-claimed', xp: 10, label: 'Merlín took ORCA-12' }
      ]
    })
    await expect(left).toHaveText('190 XP to Lv 3', { timeout: 60_000 })

    // ORCA-1264: the bar before and after a merge, then a level-up that keeps the carry-over.
    const award = (reward: { id: string; kind: string; xp: number; label: string }) =>
      client.call('game.xp', { worktreeId, terminalHandle: lead, rewards: [reward] })
    // Why: a capture or a watch must not start while the last gain still plays.
    const atRest = () =>
      expect(
        xp.locator('[data-team-xp-gain], [data-team-xp-float], [data-team-xp-note]')
      ).toHaveCount(0, { timeout: 15_000 })
    const captureMatrix = async (stage: string): Promise<void> => {
      await atRest()
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          // Why the panel: a full window shows the terminal's real user@host prompt.
          await panel.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`xp-${stage}-${width}-${theme}.png`)
          })
        }
      }
    }
    // Why sampled each frame: the label rises and fades, so one capture cannot show it never
    // crosses the project name above the row, nor that the line under the bar stays off the bar row.
    const watchPlay = () =>
      orcaPage.evaluate(
        () =>
          new Promise<{ floatTop: number | null; titleBottom: number; noteGap: number | null }>(
            (resolve) => {
              const title = document.querySelector('[data-testid="team-panel"] h2')!
              let floatTop: number | null = null
              let noteGap: number | null = null
              let seen = false
              const tick = (): void => {
                const playing = document.querySelector('[data-team-xp-gain]')
                const float = document
                  .querySelector('[data-team-xp-float]')
                  ?.getBoundingClientRect()
                // Why width: a label hidden at phone width has an empty box, which is no overlap.
                if (float && float.width > 0) {
                  floatTop = Math.min(floatTop ?? float.top, float.top)
                }
                const note = document.querySelector('[data-team-xp-note]')?.getBoundingClientRect()
                const row = document.querySelector('[data-team-xp] > div')?.getBoundingClientRect()
                if (note && note.width > 0 && row) {
                  noteGap = Math.min(noteGap ?? note.top - row.bottom, note.top - row.bottom)
                }
                seen ||= playing !== null
                if (seen && !playing) {
                  resolve({ floatTop, titleBottom: title.getBoundingClientRect().bottom, noteGap })
                  return
                }
                requestAnimationFrame(tick)
              }
              tick()
            }
          )
      )
    // Why mid-play: the gained segment and the rising label exist only while the gain plays.
    const playAward = async (
      stage: string,
      reward: Parameters<typeof award>[0],
      settled: string
    ): Promise<void> => {
      await atRest()
      const width = orcaPage.viewportSize()!.width
      const watched = watchPlay()
      await award(reward)
      await expect(left).toHaveText(settled, { timeout: 60_000 })
      await panel.screenshot({ path: testInfo.outputPath(`xp-${stage}-playing-${width}.png`) })
      const { floatTop, titleBottom, noteGap } = await watched
      if (width <= 390) {
        expect(floatTop, `no label floats over the ${width}px bar row`).toBeNull()
      } else {
        expect(floatTop, `the ${stage} label floats`).not.toBeNull()
        expect(floatTop!, `the ${stage} label stays below the project name`).toBeGreaterThanOrEqual(
          titleBottom
        )
      }
      if (noteGap !== null) {
        expect(noteGap, `the ${stage} line stays under the bar row`).toBeGreaterThanOrEqual(0)
      }
    }
    await captureMatrix('before-merge')
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await setTheme(orcaPage, 'dark')
    await playAward(
      'merge',
      { id: 'review-merged:github#13@wt-12', kind: 'review-merged', xp: 100, label: '#13 merged' },
      '90 XP to Lv 3'
    )
    await captureMatrix('after-merge')

    await orcaPage.setViewportSize({ width: 390, height: 844 })
    await setTheme(orcaPage, 'dark')
    // 90 XP to Lv 3, then +100: Lv 3 starts at 300 and keeps the 10 over.
    await playAward(
      'level-up',
      {
        id: 'perfect-merge:github#13@wt-12',
        kind: 'perfect-merge',
        xp: 100,
        label: '#13 perfect merge'
      },
      '290 XP to Lv 4'
    )
    await expect(level).toHaveText('Lv 3')
    await expect(xp.locator('[data-team-xp-gain]')).toHaveCount(0, { timeout: 10_000 })
    const fill = await xp.locator('.bg-foreground\\/60').evaluate((bar) => bar.style.width)
    expect(Number.parseFloat(fill)).toBeCloseTo((10 / 300) * 100, 3)
    await captureMatrix('after-level-up')

    // A second level-up at the narrowest width: Lv 4 starts at 600, 310 XP into Lv 3 keeps 10.
    await orcaPage.setViewportSize({ width: 320, height: 844 })
    await playAward(
      'level-up',
      {
        id: 'work-item-done:plane:ORCA-12',
        kind: 'work-item-done',
        xp: 300,
        label: 'ORCA-12 Done'
      },
      '390 XP to Lv 5'
    )
    await expect(level).toHaveText('Lv 4')

    // The tooltip says what earns XP and keeps a margin inside a phone-width window.
    await orcaPage.setViewportSize({ width: 390, height: 844 })
    await xp.hover()
    const tip = orcaPage.locator('[data-slot="tooltip-content"]')
    await expect(tip).toContainText('What earns XP')
    const box = (await tip.boundingBox())!
    expect(box.x, 'the tooltip keeps a left margin').toBeGreaterThanOrEqual(8)
    expect(box.x + box.width, 'the tooltip keeps a right margin').toBeLessThanOrEqual(390 - 8)
    await panel.screenshot({ path: testInfo.outputPath('xp-tooltip-390.png') })
    await orcaPage.mouse.move(0, 0)
    const state = (
      await client.call<OrchestratorGameState>('game.state', {
        worktreeId,
        terminalHandle: lead,
        paneKey: pane.paneKey
      })
    ).result
    expect(state.lead?.label).toBeUndefined()

    for (const language of ['en', 'es'] as const) {
      await writeSettings(orcaPage, { uiLanguage: language })
      await expect(xp).toContainText(language === 'es' ? '390 XP para Nv 5' : '390 XP to Lv 5')
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          const cut = await xp.evaluate((node) => node.scrollWidth > node.clientWidth)
          expect(cut, `the XP row is cut at ${width}px ${theme}`).toBe(false)
          await panel.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`lead-defaults-${language}-${width}-${theme}.png`)
          })
        }
      }
    }
  } finally {
    agent.dispose()
  }
})
