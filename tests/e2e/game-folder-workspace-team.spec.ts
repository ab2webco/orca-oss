import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { enablePluginSystem } from './helpers/game-cycle-contract'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { runOrcaCli } from './helpers/orca-cli-process'
import { waitForSessionReady } from './helpers/store'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { AgentHookEndpoint } from '../../src/shared/agent-hook-endpoint-file'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]

// Why Claude: the lead and the other session are Claude panes, as in the live check; the
// launched Codex member then has the global login to itself.
async function postClaudePrompt(
  endpoint: AgentHookEndpoint,
  pane: { paneKey: string; worktreeId: string },
  prompt: string
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
    body: JSON.stringify({
      paneKey: pane.paneKey,
      tabId: pane.paneKey.split(':')[0],
      worktreeId: pane.worktreeId,
      env: endpoint.env,
      version: endpoint.version,
      payload: { hook_event_name: 'UserPromptSubmit', prompt }
    })
  })
  expect(response.status).toBe(204)
}

// ORCA-1135: a lead in a project-group folder workspace (no git, no repo record) sees and adopts
// that folder's other agents, launches a member that runs in the folder, and the panel shows it.
// Why both groups (ORCA-1141 F7): a group made by name has no parentPath, and its folder's
// agents were never listed, so the live check found and launched nothing there.
const GROUPS = [
  { kind: 'folder group', parentPath: true },
  { kind: 'named group', parentPath: false }
] as const
for (const [plugins, group] of [false, true].flatMap((one) =>
  GROUPS.map((g) => [one, g] as const)
)) {
  test(`a lead in a folder workspace finds, launches and shows its team (plugins ${plugins ? 'on' : 'off'}, ${group.kind})`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(420_000)
    const agent = createStdinLoggingAgent()
    const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-folder-ws-team-')))
    writeFileSync(path.join(folder, 'notes.md'), 'folder workspace\n')
    try {
      await waitForSessionReady(orcaPage)
      const listed = plugins ? await enablePluginSystem(orcaPage) : []
      writeFileSync(testInfo.outputPath('plugins.json'), JSON.stringify(listed))
      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const client = new RuntimeClient(userDataDir, 30_000, null, null)
      await orcaPage.evaluate(async (command) => {
        await window.__store!.getState().updateSettings({
          defaultTuiAgent: 'codex',
          agentCmdOverrides: { codex: command },
          agentDefaultArgs: { codex: '' }
        })
      }, agent.command)
      const made = await client.call<{ group: { id: string } }>('projectGroup.create', {
        name: 'Folder team',
        ...(group.parentPath ? { parentPath: folder } : {}),
        createdFrom: 'manual'
      })
      const created = await client.call<{ folderWorkspace: { id: string } }>(
        'folderWorkspace.create',
        { projectGroupId: made.result.group.id, folderPath: folder, name: 'Folder team ws' }
      )
      const worktreeId = `folder:${created.result.folderWorkspace.id}`
      await orcaPage.evaluate(async (id) => {
        const store = window.__store!.getState()
        await store.fetchProjectGroups()
        await store.fetchFolderWorkspaces()
        window.__store!.getState().setActiveWorktree(id)
      }, worktreeId)

      const open = async (command: string) =>
        (
          await client.call<{ terminal: { handle: string } }>('terminal.create', {
            worktree: `id:${worktreeId}`,
            command
          })
        ).result.terminal.handle
      const lead = await open('node -e "setInterval(() => {}, 1e9)"')
      const other = await open('node -e "setInterval(() => {}, 1e9)"')
      const paneOf = async (handle: string) => {
        const all = await client.call<RuntimeTerminalListResult>('terminal.list')
        const one = all.result.terminals.find((t) => t.handle === handle)!
        return { paneKey: `${one.tabId}:${one.leafId}`, worktreeId: one.worktreeId }
      }
      const leadPane = await paneOf(lead)
      const otherPane = await paneOf(other)
      expect(leadPane.worktreeId).toBe(worktreeId)
      await expect
        .poll(
          async () =>
            (
              await client.call<{ registered: boolean }>('game.leadRegister', {
                terminalHandle: lead,
                project: 'folder-ws-e2e',
                label: 'Alfred'
              })
            ).result.registered
        )
        .toBe(true)
      const endpoint = await readHookEndpoint(electronApp)
      const readState = async () =>
        (
          await client.call<OrchestratorGameState>('game.state', {
            worktreeId,
            terminalHandle: lead,
            paneKey: leadPane.paneKey
          })
        ).result
      const foundOf = (state: OrchestratorGameState) =>
        state.agents.filter((one) => one.found).map((one) => one.paneKey)

      // Before the lead reports: the folder alone must scope its project.
      await expect
        .poll(
          async () => {
            await postClaudePrompt(endpoint, otherPane, 'Other')
            const state = await readState()
            return { role: state.role, folder: state.worktree?.folder, found: foundOf(state) }
          },
          { timeout: 60_000, message: 'game.state never found the folder agent' }
        )
        .toEqual({ role: 'lead', folder: true, found: [otherPane.paneKey] })
      await postClaudePrompt(endpoint, leadPane, 'Lead')
      await expect
        .poll(async () => foundOf(await readState()), { timeout: 30_000 })
        .toEqual([otherPane.paneKey])

      const launch = runOrcaCli(
        userDataDir,
        {
          ORCA_TERMINAL_HANDLE: lead,
          ORCA_WORKTREE_ID: worktreeId,
          ORCA_PANE_KEY: leadPane.paneKey
        },
        ['game', 'launch', 'E2E-1135', '--agent', 'codex', '--json']
      )
      writeFileSync(testInfo.outputPath('launch.txt'), `${launch.stdout}\n${launch.stderr}`)
      expect(launch.status, `${launch.stdout}\n${launch.stderr}`).toBe(0)
      expect(launch.stderr).not.toMatch(/git|worktree/i)
      const launched = JSON.parse(launch.stdout) as {
        result: { state: string; folder?: string; effects?: { kind: string; id?: string }[] }
      }
      expect(launched.result.folder).toBe(folder)
      expect(launched.result.state).not.toBe('failed')
      const memberHandle = launched.result.effects?.find((one) => one.kind === 'terminal')?.id
      expect(memberHandle, 'the member opened no terminal').toBeTruthy()
      const memberPane = await paneOf(memberHandle!)
      expect(memberPane.worktreeId).toBe(worktreeId)
      // The folder keeps its own name; a member does not rename a folder it shares.
      const folders = await client.call<{ folderWorkspaces: { id: string; name: string }[] }>(
        'folderWorkspace.list'
      )
      expect(
        folders.result.folderWorkspaces.find((one) => one.id === created.result.folderWorkspace.id)
          ?.name
      ).toBe('Folder team ws')

      await expect
        .poll(
          async () => {
            await emitCodexHookStatus(endpoint, { ...memberPane, state: 'working', prompt: 'Work' })
            const state = await readState()
            return {
              members: state.agents
                .filter((one) => one.isMember && !one.isLeader && !one.found)
                .map((one) => one.paneKey),
              found: foundOf(state)
            }
          },
          { timeout: 90_000, message: 'game.state never listed the folder member' }
        )
        .toEqual({ members: [memberPane.paneKey], found: [otherPane.paneKey] })

      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setRightSidebarOpen(true)
        state.setRightSidebarTab('team')
      })
      const panel = orcaPage.getByTestId('team-panel')
      await expect(panel.locator('[data-team-card="lead"]')).toHaveCount(1, { timeout: 60_000 })
      const cards = panel.locator('[data-team-card="member"]')
      await expect(cards).toHaveCount(2, { timeout: 60_000 })
      await expect(
        panel.locator(`[data-team-card="member"][data-pane-key="${memberPane.paneKey}"]`)
      ).toContainText('In the folder, no worktree')

      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await orcaPage.evaluate(async (next) => {
            const settings = await window.api.settings.set({ theme: next })
            window.__store?.setState({ settings })
          }, theme)
          await orcaPage.waitForTimeout(300)
          const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
          expect(overflow, `panel overflows at ${width}px ${theme}`).toBeLessThanOrEqual(0)
          await orcaPage.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`folder-team-${plugins ? 'on' : 'off'}-${width}-${theme}.png`)
          })
        }
      }
    } finally {
      agent.dispose()
      rmSync(folder, { recursive: true, force: true })
    }
  })
}
