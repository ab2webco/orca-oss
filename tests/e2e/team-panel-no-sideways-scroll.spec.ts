import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

// The ORCA-1092 audit's sidebar widths; 220 to 456 scrolled sideways by 53 px (row 23).
const SIDEBAR_WIDTHS = [220, 300, 456, 600, 1000]
const WIDTHS = [1440, 768, 390, 320]
// No character prefix, so the card shows all of it, as a paused member's raw name did.
const LONG_NAME = 'Kaelthas Sunstrider Keeper of the Very Long README Hook ORCA-957'

// Every box in the panel that scrolls sideways, by how far: a hidden bar still scrolls.
async function sidewaysScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="team-panel"]')
    if (!panel) {
      return ['no team panel']
    }
    return [panel, ...panel.querySelectorAll('*')]
      .filter((node) => {
        const { overflowX } = getComputedStyle(node)
        const scrolls = node === panel || overflowX === 'auto' || overflowX === 'scroll'
        // Why: the tab strip scrolls by design (#1020) and shows where more tabs lie.
        return (
          scrolls && node.getAttribute('role') !== 'tablist' && node.scrollWidth > node.clientWidth
        )
      })
      .map(
        (node) =>
          `${node.tagName.toLowerCase()}${node.getAttribute('role') ? `[role=${node.getAttribute('role')}]` : ''} by ${node.scrollWidth - node.clientWidth}px`
      )
  })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
}

async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const width of SIDEBAR_WIDTHS) {
    await page.evaluate((next) => window.__store!.setState({ rightSidebarWidth: next }), width)
    await expect
      .poll(() => sidewaysScrollers(page), { message: `${where} at sidebar ${width}px` })
      .toEqual([])
  }
}

test('the Team panel never scrolls sideways, with a long member name or no team', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
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
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    }, agent.command)
    const panel = orcaPage.getByTestId('team-panel')
    await expect(panel).toBeVisible({ timeout: 60_000 })

    // No team yet: the Activity view (ORCA-1074), with a long session name, prompt and tool line.
    await orcaPage.evaluate(
      ({ paneKey, name }) =>
        window.__store!.getState().setAgentStatus(
          paneKey,
          {
            state: 'working',
            prompt: `Check ${name} and every merge queue run it touched`,
            agentType: 'claude',
            toolName: 'Bash',
            toolInput: `gh pr checks 912 --watch --interval 30 --json name,state,${'bucket,'.repeat(8)}`
          },
          name
        ),
      { paneKey: pane.paneKey, name: LONG_NAME }
    )
    await expect(panel.locator('[data-team-activity-tab]')).toBeVisible({ timeout: 60_000 })
    await expect(panel.locator('[data-team-activity="selected"]')).toContainText('gh pr checks 912')
    await expectNoSidewaysScroll(orcaPage, 'the no-team Activity view')
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({ path: testInfo.outputPath(`no-team-${width}-${theme}.png`) })
      }
    }

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
      objective: 'Sideways scroll',
      from: lead
    })
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
          ).result.worktrees.some((one) => one.id === worktreeId),
        { timeout: 60_000, message: 'the runtime never listed the active worktree' }
      )
      .toBe(true)
    const member = async (ticket: string, displayName: string) => {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: displayName,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName,
        agent: 'codex',
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId: terminal!.worktreeId }
    }
    const members = [
      await member('ORCA-957', LONG_NAME),
      await member('ORCA-12', 'Merlín · ORCA-12 Keep the look')
    ]
    await expect
      .poll(
        async () => {
          for (const one of members) {
            await emitCodexHookStatus(endpoint, { ...one, state: 'working', prompt: 'Work' })
          }
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey
            })
          ).result
          return state.agents.filter((one) => one.isMember && !one.isLeader).length
        },
        { timeout: 90_000, message: 'game.state never listed the two members' }
      )
      .toBe(2)
    const cards = panel.locator('[data-team-card="member"]')
    await expect(cards).toHaveCount(2, { timeout: 90_000 })
    await expect(cards.filter({ hasText: 'ORCA-957' })).toContainText('Kaelthas')

    await expectNoSidewaysScroll(orcaPage, 'the Team tab with a long member name')
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        expect(await sidewaysScrollers(orcaPage), `Team tab at ${width}px ${theme}`).toEqual([])
        await orcaPage.screenshot({
          path: testInfo.outputPath(`team-long-name-${width}-${theme}.png`)
        })
      }
    }
  } finally {
    agent.dispose()
  }
})
