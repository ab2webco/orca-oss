import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]

// ORCA-1094 asks for the cards compared in a folder workspace too: a lead and a member in a
// plain folder with no git, where there is no branch and no member worktree of its own.
test('a team in a folder workspace gets its cards, names and faces', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  const agent = createStdinLoggingAgent()
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-folder-team-')))
  writeFileSync(path.join(folder, 'notes.md'), 'folder workspace\n')
  try {
    await waitForSessionReady(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    await orcaPage.evaluate(async (command) => {
      await window.__store!.getState().updateSettings({
        uiLanguage: 'es',
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)

    const added = await client.call<{ repo: { id: string } }>('repo.add', {
      path: folder,
      kind: 'folder'
    })
    const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {
      repo: `id:${added.result.repo.id}`
    })
    const worktreeId = listed.result.worktrees[0]!.id
    await orcaPage.evaluate((id) => window.__store!.getState().setActiveWorktree(id), worktreeId)
    const created = await client.call<{ terminal: { handle: string } }>('terminal.create', {
      worktree: `id:${worktreeId}`,
      command: 'node -e "setInterval(() => {}, 1e9)"'
    })
    const lead = created.result.terminal.handle
    const paneOf = async (handle: string) => {
      const all = await client.call<RuntimeTerminalListResult>('terminal.list')
      const one = all.result.terminals.find((t) => t.handle === handle)!
      return { paneKey: `${one.tabId}:${one.leafId}`, worktreeId: one.worktreeId }
    }
    const leadPane = await paneOf(lead)
    await expect
      .poll(async () => {
        const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
          terminalHandle: lead,
          project: 'folder-e2e',
          label: 'Alfred'
        })
        return registered.result.registered
      })
      .toBe(true)
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, { ...leadPane, state: 'working', prompt: 'Lead the team' })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Folder cards',
      from: lead
    })
    const title = 'Sabio · ORCA-33 Folder look'
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-33',
      taskTitle: title,
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: title,
        agent: 'codex',
        timeoutMs: 20_000
      }
    )
    const handle = started.result.effects.find(
      (e) => e.kind === 'terminal' && e.role === 'agent'
    )?.id
    expect(handle, 'workerStart opened no agent terminal in the folder').toBeTruthy()
    const memberPane = await paneOf(handle!)
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, { ...memberPane, state: 'working', prompt: 'Work' })
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: leadPane.paneKey
            })
          ).result
          return state.agents.filter((one) => one.isMember && !one.isLeader).length
        },
        { timeout: 90_000, message: 'game.state never listed the folder member' }
      )
      .toBe(1)

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const card = panel.locator('[data-team-card="member"]')
    await expect(card).toHaveCount(1, { timeout: 90_000 })
    await expect(card).toContainText('Sabio')
    await expect(card).toContainText('ORCA-33')
    await expect(card).not.toContainText('Folder look')
    await expect(panel.locator('canvas[data-team-face]')).toHaveCount(2)

    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await writeSettings(orcaPage, { theme })
        await orcaPage.waitForTimeout(200)
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows at ${width}px ${theme}`).toBeLessThanOrEqual(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`folder-cards-${width}-${theme}.png`)
        })
      }
    }
  } finally {
    agent.dispose()
    rmSync(folder, { recursive: true, force: true })
  }
})
