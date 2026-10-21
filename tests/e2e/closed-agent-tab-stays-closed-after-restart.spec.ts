import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import {
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import {
  ensureTerminalVisible,
  getWorktreeTabs,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { SleepingAgentSessionRecord } from '../../src/shared/agent-session-resume'

// ORCA-718 (owner rule): after a restart Orca reopens only what was open when it quit. A CLI
// close keeps the agent's resume record (ORCA-487), and the startup resume pass used to read
// that tab-less record as a lost pane and relaunch it in a new tab.

test.describe.configure({ mode: 'serial' })

test('an agent tab closed through the CLI does not come back after a restart', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
  if (!repoPath || !existsSync(repoPath)) {
    test.skip(true, 'Global setup did not produce a seeded test repo')
    return
  }

  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null

  try {
    const firstLaunch = await session.launch()
    firstApp = firstLaunch.app
    const worktreeId = await attachRepoAndOpenTerminal(firstLaunch.page, repoPath)
    await waitForSessionReady(firstLaunch.page)
    await waitForActiveWorktree(firstLaunch.page)
    await ensureTerminalVisible(firstLaunch.page)
    const hasPaneManager = await waitForActiveTerminalManager(firstLaunch.page, 30_000)
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hasPaneManager,
      'Electron automation in this environment never mounted the TerminalPane manager.'
    )
    await waitForActivePanePtyId(firstLaunch.page)
    const { paneKey } = await waitForActivePaneHookDescriptor(firstLaunch.page)

    // Why seeded: a running Claude pane captures this live record; `echo` keeps old code's
    // relaunch from needing a real agent binary.
    const record: SleepingAgentSessionRecord = {
      paneKey,
      tabId: paneKey.split(':')[0]!,
      worktreeId,
      agent: 'claude',
      providerSession: { key: 'session_id', id: randomUUID() },
      prompt: '',
      state: 'working',
      capturedAt: Date.now(),
      updatedAt: Date.now(),
      origin: 'live',
      launchConfig: { agentCommand: 'echo', agentArgs: '', agentEnv: {} }
    }
    await firstLaunch.page.evaluate((next) => {
      window.__store?.setState((state) => ({
        sleepingAgentSessionsByPaneKey: {
          ...state.sleepingAgentSessionsByPaneKey,
          [next.paneKey]: next
        }
      }))
    }, record)

    const client = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const resolved = await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey
    })
    await client.call('terminal.close', { terminal: resolved.result.terminal.handle })
    await expect
      .poll(() => getWorktreeTabs(firstLaunch.page, worktreeId), {
        message: 'The CLI close left the agent tab in renderer state'
      })
      .toEqual([])
    // The path under test: the close keeps the record, so only the restart can bring it back.
    expect(
      await firstLaunch.page.evaluate(
        (key) => Boolean(window.__store?.getState().sleepingAgentSessionsByPaneKey[key]),
        paneKey
      )
    ).toBe(true)

    await session.close(firstApp)
    firstApp = null

    const secondLaunch = await session.launch()
    secondApp = secondLaunch.app
    await waitForSessionReady(secondLaunch.page)
    expect(await attachRepoAndOpenTerminal(secondLaunch.page, repoPath)).toBe(worktreeId)
    // Why: wait past the startup resume pass and worktree activation effects.
    await secondLaunch.page.waitForTimeout(1_000)

    const restored = await secondLaunch.page.evaluate(
      ({ key, id }) => {
        const state = window.__store?.getState()
        return {
          activeWorktreeId: state?.activeWorktreeId ?? null,
          tabCount: state?.tabsByWorktree[id]?.length ?? 0,
          resumeClaimCount: Object.keys(state?.automaticAgentResumeClaimsByTabId ?? {}).length,
          recoveryPresent: Boolean(state?.sleepingAgentSessionsByPaneKey[key])
        }
      },
      { key: paneKey, id: worktreeId }
    )
    expect(restored).toEqual({
      activeWorktreeId: worktreeId,
      tabCount: 0,
      resumeClaimCount: 0,
      // Kept so the conversation can still be resumed by hand.
      recoveryPresent: true
    })
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
