import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
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
// `name · ticket · host`, and the header levels the team from its characters' real XP.
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
    await orcaPage.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        uiLanguage: 'en',
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
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
    await expect(xp).toContainText('Lv 1', { timeout: 60_000 })
    await expect(xp).toContainText('0/100 XP')
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
    await expect(xp).toContainText('Lv 2', { timeout: 60_000 })
    await expect(xp).toContainText('0/200 XP')
    const state = (
      await client.call<OrchestratorGameState>('game.state', {
        worktreeId,
        terminalHandle: lead,
        paneKey: pane.paneKey
      })
    ).result
    expect(state.lead?.label).toBeUndefined()

    for (const language of ['en', 'es'] as const) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      await expect(xp).toContainText(language === 'es' ? 'Nv 2' : 'Lv 2')
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          const cut = await xp.evaluate((node) => node.scrollWidth > node.clientWidth)
          expect(cut, `the XP row is cut at ${width}px ${theme}`).toBe(false)
          await orcaPage.screenshot({
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
