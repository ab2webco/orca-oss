import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { waitForActivePanePtyId, waitForActiveTerminalManager } from './helpers/terminal'
import {
  ensureTerminalVisible,
  getWorktreeTabs,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

// ORCA-718 (audit row 26): a lead opened through the runtime and closed with `orca terminal close`
// came back after a restart as a sleeping Lead tab. The close keeps its resume record (ORCA-487),
// and terminal.list built a sleeping row from it.

test.describe.configure({ mode: 'serial' })

async function ensureClaudeSession(
  client: RuntimeClient,
  page: Page,
  worktreeId: string,
  sessionId: string
): Promise<string> {
  // Why retry: the runtime resolves the worktree only after the renderer publishes it.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const ensured = await client.call<{ terminal: { handle: string } }>(
        'terminal.ensureAgentSession',
        {
          kind: 'explicit',
          worktree: `id:${worktreeId}`,
          agent: 'claude',
          providerSession: { key: 'session_id', id: sessionId },
          presentation: 'focused'
        }
      )
      return ensured.result.terminal.handle
    } catch (error) {
      if (attempt >= 40) {
        throw error
      }
      await page.waitForTimeout(500)
    }
  }
}

async function listedTabIds(client: RuntimeClient): Promise<string[]> {
  const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
  return listed.result.terminals.map((terminal) => terminal.tabId)
}

test('a lead closed with terminal.close does not come back after a restart', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null

  try {
    const firstLaunch = await session.launch()
    firstApp = firstLaunch.app
    const page = firstLaunch.page
    const worktreeId = await attachRepoAndOpenTerminal(page, repoPath)
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await waitForActiveTerminalManager(page, 30_000)
    await waitForActivePanePtyId(page)
    const [control] = await getWorktreeTabs(page, worktreeId)
    // Why `echo claude`: the lead's launch shape without a real Claude CLI.
    await page.evaluate(() =>
      window.__store!.getState().updateSettings({ agentCmdOverrides: { claude: 'echo claude' } })
    )

    const sessionId = randomUUID()
    // Why: a resume whose conversation the shared store lacks is refused (ORCA-718).
    session.seedClaudeTranscriptStore({
      appUserDataDir: await firstLaunch.app.evaluate(({ app }) => app.getPath('userData')),
      sessionId
    })
    const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const handle = await ensureClaudeSession(client, page, worktreeId, sessionId)
    await expect.poll(async () => (await getWorktreeTabs(page, worktreeId)).length).toBe(2)
    const leadTabId = (await getWorktreeTabs(page, worktreeId)).find(
      (tab) => tab.id !== control!.id
    )!.id
    // Why seeded: a running lead's hooks report this status, which captures its live record.
    await page.evaluate(
      ({ tabId, id, sid }) => {
        const state = window.__store!.getState()
        const layout = state.terminalLayoutsByTabId[tabId]
        const leafId = layout?.activeLeafId ?? Object.keys(layout?.ptyIdsByLeafId ?? {})[0]
        state.setAgentStatus(
          `${tabId}:${leafId}`,
          { state: 'working', prompt: 'lead', agentType: 'claude' },
          'Claude',
          undefined,
          { worktreeId: id },
          { providerSession: { key: 'session_id', id: sid } }
        )
        state.captureAllSleepingAgentSessions('periodic')
      },
      { tabId: leadTabId, id: worktreeId, sid: sessionId }
    )

    await client.call('terminal.close', { terminal: handle })
    await expect.poll(() => getWorktreeTabs(page, worktreeId)).toEqual([control])
    // The path under test: the close keeps the record, so only the listing could bring it back.
    expect(
      await page.evaluate(
        (sid) =>
          Object.values(window.__store!.getState().sleepingAgentSessionsByPaneKey).some(
            (record) => record.providerSession.id === sid
          ),
        sessionId
      )
    ).toBe(true)
    expect(await listedTabIds(client)).not.toContain(leadTabId)

    await session.close(firstApp)
    firstApp = null

    const secondLaunch = await session.launch()
    secondApp = secondLaunch.app
    await waitForSessionReady(secondLaunch.page)
    expect(await attachRepoAndOpenTerminal(secondLaunch.page, repoPath)).toBe(worktreeId)
    // Why: wait past the startup resume pass and worktree activation effects.
    await secondLaunch.page.waitForTimeout(2_000)

    expect(await getWorktreeTabs(secondLaunch.page, worktreeId)).toEqual([control])
    const relaunchedClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    expect(await listedTabIds(relaunchedClient)).not.toContain(leadTabId)
    await secondLaunch.page.screenshot({ path: testInfo.outputPath('after-restart.png') })
  } finally {
    if (firstApp) {
      await session.close(firstApp)
    }
    if (secondApp) {
      await session.close(secondApp)
    }
    await session.dispose()
  }
})
