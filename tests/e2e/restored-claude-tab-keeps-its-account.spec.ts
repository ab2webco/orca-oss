import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import {
  getTerminalContent,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { PROTOCOL_VERSION } from '../../src/main/daemon/types'
import { DEFAULT_LOCAL_ORCA_PROFILE_ID } from '../../src/shared/orca-profiles'
import type { SleepingAgentSessionRecord } from '../../src/shared/agent-session-resume'

// ORCA-718: a Claude tab open at quit cold-restores on a fresh PTY after the daemon dies, and its
// old account binding died with the CLI. It used to resume on the global login; it must keep the
// account that owns its transcript, or refuse when that account is gone.

const PROVIDER_SESSION_ID = 'e2e-orca-718-removed-account-session'

type PersistedData = {
  workspaceSession?: {
    tabsByWorktree?: Record<string, { ptyId?: unknown }[]>
    terminalLayoutsByTabId?: Record<string, unknown>
    activeWorktreeIdsOnShutdown?: unknown
    sleepingAgentSessionsByPaneKey?: Record<string, { providerSession?: { id?: unknown } }>
  }
}

function dataFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'profiles', DEFAULT_LOCAL_ORCA_PROFILE_ID, 'orca-data.json')
}

function readPersistedData(userDataDir: string): PersistedData {
  return JSON.parse(readFileSync(dataFilePath(userDataDir), 'utf8')) as PersistedData
}

function readDaemonPid(userDataDir: string): number {
  const raw = readFileSync(
    path.join(userDataDir, 'daemon', `daemon-v${PROTOCOL_VERSION}.pid`),
    'utf8'
  )
  return (JSON.parse(raw) as { pid: number }).pid
}

function killPid(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

async function forceKillElectronApp(app: ElectronApplication): Promise<void> {
  const proc: ChildProcess = app.process()
  if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) {
    return
  }
  const exited = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000)
    proc.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
  killPid(proc.pid)
  await exited
}

// Why: models the crash/update artifact (#6370) — the tab and its resume record survive, but no
// daemon session or stable leaf binding owns the pane, so only a cold-restore resume can bring it back.
function stripPersistedPtyOwnership(userDataDir: string): void {
  const data = readPersistedData(userDataDir)
  const session = data.workspaceSession!
  for (const tabs of Object.values(session.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      tab.ptyId = null
    }
  }
  session.terminalLayoutsByTabId = {}
  session.activeWorktreeIdsOnShutdown = []
  writeFileSync(dataFilePath(userDataDir), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

test.describe.configure({ mode: 'serial' })

test('a restored Claude tab never resumes on the global login when its account was removed', async ({
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
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hydrationSucceeded === true), {
        timeout: 30_000
      })
      .toBe(true)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await waitForActiveTerminalManager(page, 30_000)
    await waitForActivePanePtyId(page)
    const { paneKey } = await waitForActivePaneHookDescriptor(page)

    // Why `echo claude`: the spawn must read as a Claude launch without a real CLI; on the old
    // code it ran and printed the resume line on the global login.
    const record: SleepingAgentSessionRecord = {
      paneKey,
      tabId: paneKey.split(':')[0]!,
      worktreeId,
      agent: 'claude',
      providerSession: {
        key: 'session_id',
        id: PROVIDER_SESSION_ID,
        transcriptPath: path.join(
          session.userDataDir,
          'claude-accounts',
          'acct-removed',
          'auth',
          'projects',
          '-repo',
          `${PROVIDER_SESSION_ID}.jsonl`
        )
      },
      prompt: '',
      state: 'working',
      capturedAt: Date.now(),
      updatedAt: Date.now(),
      origin: 'quit',
      launchConfig: { agentCommand: 'echo claude', agentArgs: '', agentEnv: {} }
    }
    await page.evaluate((next) => {
      window.__store?.setState((state) => ({
        sleepingAgentSessionsByPaneKey: {
          ...state.sleepingAgentSessionsByPaneKey,
          [next.paneKey]: next
        }
      }))
    }, record)
    await expect
      .poll(
        () =>
          Object.values(
            readPersistedData(session.userDataDir).workspaceSession
              ?.sleepingAgentSessionsByPaneKey ?? {}
          ).some((entry) => entry.providerSession?.id === PROVIDER_SESSION_ID),
        { timeout: 30_000, message: 'the resume record never reached disk' }
      )
      .toBe(true)

    const daemonPid = readDaemonPid(session.userDataDir)
    await forceKillElectronApp(firstApp)
    firstApp = null
    killPid(daemonPid)
    stripPersistedPtyOwnership(session.userDataDir)

    const secondLaunch = await session.launch()
    secondApp = secondLaunch.app
    const restored = secondLaunch.page
    await waitForSessionReady(restored)
    await expect
      .poll(() => restored.evaluate(() => window.__store?.getState().activeWorktreeId), {
        timeout: 15_000
      })
      .toBe(worktreeId)
    await ensureTerminalVisible(restored)
    await waitForActiveTerminalManager(restored, 30_000)

    await expect
      .poll(() => restored.evaluate(() => document.body.innerText), {
        timeout: 30_000,
        message: 'the restored pane never said its Claude account was removed'
      })
      .toContain('The Claude account that owns this conversation was removed')
    expect(await getTerminalContent(restored)).not.toContain(`--resume ${PROVIDER_SESSION_ID}`)
    await restored.screenshot({ path: testInfo.outputPath('restored-pane.png') })
  } finally {
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await forceKillElectronApp(firstApp)
    }
    await session.dispose()
  }
})
