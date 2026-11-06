import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]
const COMMAND = 'npx vitest run terminal-role'
type Call = (
  event: unknown,
  args: { method: string }
) => Promise<{ result?: Record<string, unknown> }>

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// Why: E2E has no Jev plugin and no PR provider, so the Advisor row and a PR are added to the
// real game.state on its way to the renderer; everything else is what the runtime reports.
async function addAdvisorAndPr(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Call> })._invokeHandlers
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      if (args.method !== 'game.state' || !Array.isArray(response.result?.agents)) {
        return response
      }
      const agents = (response.result.agents as { isLeader?: boolean; displayName?: string }[]).map(
        (one) =>
          one.isLeader
            ? {
                ...one,
                advisor: {
                  model: 'Opus 5.5',
                  effort: 'medium',
                  pinned: { model: false, effort: false },
                  line: 'Watching the CI of #923',
                  previous: null
                }
              }
            : one.displayName?.includes('ORCA-12')
              ? {
                  ...one,
                  review: {
                    provider: 'github',
                    number: 924,
                    title: 'Keep the look',
                    url: 'https://github.com/o/r/pull/924',
                    state: 'open',
                    ci: 'failure'
                  }
                }
              : one
      )
      return { ...response, result: { ...response.result, agents } }
    })
  })
}

// ORCA-1094: the cards name the lead from Settings and members after their character, mark
// needs-you with V28's `?` and working with a spinner, and show what the tool works on.
test('Team cards carry names, live detail and V28 status marks', async ({
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
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
    await orcaPage.evaluate(async (command) => {
      const state = window.__store!.getState()
      const repoId = state.getKnownWorktreeById(state.activeWorktreeId!)!.repoId
      await state.updateSettings({
        uiLanguage: 'es',
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' },
        orchestratorGameProjects: { [repoId]: { orchestrator: { label: 'Alfred' } } }
      })
    }, agent.command)

    await client.call('terminal.send', {
      terminal: lead,
      text: 'node -e "setInterval(() => {}, 1e9)"',
      enter: true
    })
    await expect
      .poll(async () => {
        const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
          terminalHandle: lead,
          project: 'e2e',
          label: 'Alfred'
        })
        return registered.result.registered
      })
      .toBe(true)
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Card identity',
      from: lead
    })
    const member = async (ticket: string, displayName: string) => {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        // Why both: `game launch` names the task and the worker with the same `Name · ticket` title.
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
    const runner = await member('ORCA-12', 'Merlín · ORCA-12 Keep the look')
    const asker = await member('ORCA-14', 'Galván · ORCA-14 Ask first')
    const postHooks = async (): Promise<void> => {
      await emitCodexHookStatus(endpoint, {
        ...runner,
        state: 'working',
        tool: 'Bash',
        toolInput: { command: COMMAND }
      })
      await emitCodexHookStatus(endpoint, { ...asker, state: 'working', prompt: 'Work' })
    }
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-14',
      question: '¿Mergeo #14 ahora?',
      options: ['Sí', 'No']
    })
    await expect
      .poll(
        async () => {
          await postHooks()
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey
            })
          ).result
          return state.agents.find((one) => one.toolInput === COMMAND) !== undefined
        },
        { timeout: 90_000, message: 'game.state never carried the Bash command' }
      )
      .toBe(true)

    await addAdvisorAndPr(electronApp)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const leadCard = panel.locator('[data-team-card="lead"]')
    const advisor = panel.locator('[data-team-card="advisor"]')
    const cards = panel.locator('[data-team-card="member"]')
    await expect(cards).toHaveCount(2, { timeout: 90_000 })
    await postHooks()

    await expect(leadCard).toContainText('Alfred')
    await expect(leadCard.locator('[data-team-model]')).toHaveCSS('font-family', /mono/i)
    await expect(advisor).toContainText('Mago')
    await expect(advisor.locator('[data-team-model]')).toHaveCount(0)
    const merlin = cards.filter({ hasText: 'ORCA-12' })
    const galvan = cards.filter({ hasText: 'ORCA-14' })
    await expect(merlin).toContainText('Merlín')
    await expect(merlin).not.toContainText('Keep the look')
    await expect(merlin).toContainText(COMMAND, { timeout: 30_000 })
    await expect(merlin.locator('[data-status-glyph]')).toHaveAttribute(
      'data-status-glyph',
      'spinner'
    )
    await expect(galvan).toContainText('Galván')
    await expect(galvan.locator('[data-status-glyph]')).toHaveAttribute(
      'data-status-glyph',
      'question'
    )

    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows at ${width}px ${theme}`).toBeLessThanOrEqual(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`cards-${width}-${theme}.png`)
        })
      }
    }

    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await setTheme(orcaPage, 'dark')
    await merlin.locator('button[aria-expanded]').click()
    await expect(merlin.locator('[data-team-pr-chip] [data-status-tone]')).toHaveAttribute(
      'data-status-tone',
      'attention'
    )
    await panel.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('cards-expanded.png')
    })
  } finally {
    agent.dispose()
  }
})
