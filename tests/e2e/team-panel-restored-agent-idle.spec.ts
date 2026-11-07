/**
 * ORCA-1130 D8: a pane Orca last saw inside a tool reads idle after a restart, by no tool, and a raw
 * MCP tool id never reaches the panel, with the plugin system off and on.
 *
 * Why a real /hook/claude event before the restart: the stale row is the one Orca persists and
 * restores, and only the real server and listener write it.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import {
  createFakeClaude,
  expectTeamTabs,
  openTeamPanel,
  postClaudeHook,
  startIdleLead
} from './helpers/idle-lead-restart'
import { RuntimeClient } from '../../src/cli/runtime-client'

const MCP_TOOL = 'mcp__plugin_engram_engram__mem_current_project'
const TOOL_LABEL = 'engram: mem current project'

type Leads = { leads: { handle: string; paneKey?: string }[] }
type LeadAgent = { isLeader: boolean; state: string; toolName: string | null }

async function turnPluginsOn(page: Page, pluginDir: string): Promise<string[]> {
  return page.evaluate(async (dir) => {
    const settings = await window.api.settings.set({ pluginSystemEnabled: true })
    window.__store?.setState({ settings })
    await window.api.plugins.install({ kind: 'local-path', path: dir })
    await window.api.plugins.refresh()
    for (const entry of await window.api.plugins.list()) {
      if (entry.consentFingerprint && entry.status !== 'idle' && entry.status !== 'running') {
        await window.api.plugins.consent({
          pluginKey: entry.pluginKey,
          reviewedFingerprint: entry.consentFingerprint,
          decision: 'approve'
        })
      }
    }
    return (await window.api.plugins.list()).map((entry) => entry.status)
  }, pluginDir)
}

async function pluginStatuses(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await window.api.plugins.list()).map((one) => one.status))
}

for (const plugins of ['off', 'on'] as const) {
  test(`a pane restored inside a tool reads idle, with no raw tool id (plugins ${plugins})`, async ({
    flushRendererRecoveryEvidenceQueue
  }, testInfo) => {
    void flushRendererRecoveryEvidenceQueue
    test.setTimeout(240_000)
    test.skip(process.platform === 'win32', 'The fake Claude is a copy of the POSIX sleep binary')
    const repoPath = existsSync(TEST_REPO_PATH_FILE)
      ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
      : ''
    test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

    const fake = createFakeClaude()
    const pluginRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-d8-plugin-'))
    const pluginDir = path.join(pluginRoot, 'hello-orca')
    cpSync(path.join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginDir, {
      recursive: true
    })
    const session = createRestartSession(testInfo)
    let firstApp: ElectronApplication | null = null
    let secondApp: ElectronApplication | null = null
    try {
      const first = await session.launch()
      firstApp = first.app
      const lead = await startIdleLead({
        page: first.page,
        userDataDir: session.userDataDir,
        repoPath,
        fake,
        project: `e2e-restored-${plugins}`
      })
      if (plugins === 'on') {
        const statuses = await turnPluginsOn(first.page, pluginDir)
        expect(statuses).toEqual([expect.stringMatching(/^(idle|running)$/)])
      }
      // A turn whose Stop never reached Orca: the pane was last seen inside an MCP tool.
      await postClaudeHook(await readHookEndpoint(first.app), lead, {
        hook_event_name: 'PreToolUse',
        session_id: 'e2e-d8-session',
        tool_name: MCP_TOOL,
        tool_input: {}
      })
      await openTeamPanel(first.page)
      await expectTeamTabs(first.page)
      const panel = first.page.getByTestId('team-panel')
      await expect(panel).toContainText(TOOL_LABEL, { timeout: 30_000 })
      expect(await panel.innerText()).not.toContain('mcp__')
      await first.page.screenshot({ path: testInfo.outputPath('working-before.png') })

      await session.close(first.app)
      firstApp = null

      const second = await session.launch()
      secondApp = second.app
      await waitForSessionReady(second.page)
      // Why first: without the restored row, the lead would read idle for another reason (D7).
      await expect
        .poll(
          () =>
            second.page.evaluate((key) => {
              const entry = window.__store?.getState().agentStatusByPaneKey[key]
              return entry ? { unconfirmed: entry.restoredUnconfirmed, tool: entry.toolName } : null
            }, lead.paneKey),
          { timeout: 30_000 }
        )
        .toEqual({ unconfirmed: true, tool: MCP_TOOL })
      if (plugins === 'on') {
        expect(await pluginStatuses(second.page)).toEqual([
          expect.stringMatching(/^(idle|running)$/)
        ])
      }

      await openTeamPanel(second.page)
      await expectTeamTabs(second.page)
      const after = second.page.getByTestId('team-panel')
      await expect(after).toContainText('Idle', { timeout: 30_000 })
      const text = await after.innerText()
      expect(text).not.toContain('mcp__')
      expect(text).not.toContain(TOOL_LABEL)
      expect(text).not.toContain('Working')

      const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
      const leads = (await client.call<Leads>('game.leads')).result.leads
      const handle = leads.find((one) => one.paneKey === lead.paneKey)?.handle
      expect(handle).toBeTruthy()
      const state = await client.call<{ agents: LeadAgent[] }>('game.state', {
        worktreeId: lead.worktreeId,
        terminalHandle: handle,
        paneKey: lead.paneKey
      })
      expect(state.result.agents.find((one) => one.isLeader)).toMatchObject({
        state: 'idle',
        toolName: null
      })
      await second.page.screenshot({ path: testInfo.outputPath('idle-after.png') })
    } finally {
      if (secondApp) {
        await session.close(secondApp)
      }
      if (firstApp) {
        await session.close(firstApp)
      }
      await session.dispose()
      fake.dispose()
      rmSync(pluginRoot, { recursive: true, force: true })
    }
  })
}
