import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { waitForRuntimeWorktree } from './helpers/game-cycle-contract'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark')
}

// Why: the app's star and update cards can open mid-run over the panel's foot, where the dock is.
async function dismissAppCards(page: Page): Promise<void> {
  for (const name of [/^(Later|Más tarde)$/, /^(Dismiss|Descartar)$/]) {
    for (const one of await page.getByRole('button', { name }).all()) {
      if (await one.isVisible().catch(() => false)) {
        await one.click()
      }
    }
  }
}

// A launch STOP pauses launches and pushes only; members already at work keep running (ORCA-1157).
test('a launch STOP keeps Stop enabled and never reads stopped while a member runs', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    await orcaPage.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
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
    await writeSettings(orcaPage, {
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
    // Why a foreground process: a lead pane back at its shell is not a live lead.
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
    const leadHook = { paneKey: pane.paneKey, worktreeId }
    await emitCodexHookStatus(endpoint, { ...leadHook, state: 'done', lastAssistantMessage: 'Ok' })

    await waitForRuntimeWorktree(client, worktreeId)
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Stop while running',
      from: lead
    })
    const member = async (ticket: string) => {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: ticket,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: ticket,
        agent: 'codex',
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      expect(handle, `workerStart opened no agent terminal for ${ticket}`).toBeTruthy()
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      return {
        paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
        worktreeId: terminal!.worktreeId
      }
    }
    const [working, paused] = [await member('NETSA-121'), await member('NETSA-222')]
    const gameState = async (): Promise<OrchestratorGameState> =>
      (
        await client.call<OrchestratorGameState>('game.state', {
          worktreeId,
          terminalHandle: lead,
          paneKey: pane.paneKey
        })
      ).result
    const memberStates = async (): Promise<string[]> =>
      (await gameState()).agents
        .filter((one) => one.isMember && !one.isLeader)
        .map((one) => one.state)
        .sort()
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, { ...working, state: 'working', prompt: 'Fix it' })
          await emitCodexHookStatus(endpoint, {
            ...paused,
            state: 'done',
            lastAssistantMessage: 'Paused'
          })
          return memberStates()
        },
        { timeout: 90_000, message: 'game.state never listed one working, one done member' }
      )
      .toEqual(['done', 'working'])

    // The STOP `game stop-launches` sets, as the netsat lead had it.
    await client.call('game.stopSwitch', { terminalHandle: lead, set: true })
    expect((await gameState()).stopped).toMatchObject({ by: 'lead' })

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const dock = panel.locator('[data-team-action-dock]')
    await expect(panel.getByRole('region', { name: 'Actions' })).toBeVisible({ timeout: 90_000 })

    for (const [width, theme, language, paused, stop] of [
      [1440, 'dark', 'en', 'Launches and pushes paused', 'Stop every member'],
      [320, 'light', 'es', 'Lanzamientos y pushes en pausa', 'Detener a todos']
    ] as const) {
      await writeSettings(orcaPage, { uiLanguage: language })
      await setTheme(orcaPage, theme)
      await orcaPage.setViewportSize({ width, height: 900 })
      await expect(panel).toContainText(paused, { timeout: 30_000 })
      await expect(panel).not.toContainText(/Stopped by|Detenido por/)
      await expect(dock.getByRole('button', { name: stop })).toBeEnabled()
      // Why: `game push` refuses while STOP is set, so the dock does not offer it.
      await expect(dock.locator('[data-team-action]')).toHaveCount(0)
      await dismissAppCards(orcaPage)
      await orcaPage.mouse.move(0, 0)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`running-${language}-${width}-${theme}.png`)
      })
    }

    // With nobody running the same STOP is a stopped team, and Stop has nothing left to stop.
    await writeSettings(orcaPage, { uiLanguage: 'en' })
    await setTheme(orcaPage, 'dark')
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, {
            ...working,
            state: 'done',
            lastAssistantMessage: 'Done'
          })
          return memberStates()
        },
        { timeout: 60_000, message: 'the working member never read done' }
      )
      .toEqual(['done', 'done'])
    // Why the fleet event: the panel re-reads game.state on it instead of at its next poll.
    await client.call('game.stopSwitch', { terminalHandle: lead, set: true })
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('runtime:gameAdvisorChanged'))
    )
    await expect(panel).toContainText('Stopped by lead', { timeout: 30_000 })
    await expect(dock.getByRole('button', { name: 'Already stopped' })).toBeDisabled()
    await orcaPage.mouse.move(0, 0)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('idle-en-1440-dark.png')
    })

    // `game resume` clears it: the label goes and Push is offered again.
    await client.call('game.stopSwitch', { terminalHandle: lead, set: false })
    expect((await gameState()).stopped).toBeNull()
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('runtime:gameAdvisorChanged'))
    )
    await expect(panel).not.toContainText('Stopped by lead', { timeout: 30_000 })
    await expect(dock.locator('[data-team-action]')).toHaveText(['Push2'])
    await expect(dock.getByRole('button', { name: 'Stop every member' })).toBeEnabled()
  } finally {
    agent.dispose()
  }
})
