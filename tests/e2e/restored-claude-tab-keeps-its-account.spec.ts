import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
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

// ORCA-718: a Claude tab open at quit cold-restores on a fresh PTY after the daemon dies. Every
// universe links projects/ to one shared transcript store, so a conversation whose account was
// removed still resumes, on what a new launch would get; only one missing from the store cannot.

const PROVIDER_SESSION_ID = 'e2e-orca-718-removed-account-session'
const CONVERSATION_MARKER = 'ORCA718_CONVERSATION_CONTENT'

/** A stand-in `claude` that prints the conversation its own config dir can reach, the way a real
 *  resume reads it, so the pane shows both which login ran and that the content is there. */
function writeFakeClaude(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-718-fake-claude-'))
  const script = path.join(dir, 'claude')
  writeFileSync(
    script,
    [
      '#!/bin/sh',
      'while [ "$#" -gt 0 ]; do [ "$1" = "--resume" ] && id="$2"; shift; done',
      'home="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
      'echo "RESUMED_IN=$home"',
      'cat "$home"/projects/*/"$id".jsonl 2>/dev/null || echo "NO_CONVERSATION_FOUND"',
      ''
    ].join('\n')
  )
  chmodSync(script, 0o755)
  return script
}

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
// Why: the stand-in CLI is a POSIX shell script.
test.skip(process.platform === 'win32', 'the stand-in claude is a POSIX script')

const CASES = [
  {
    title: "resumes a removed account's conversation on the selected login, with its content",
    inStore: true,
    expectInPage: CONVERSATION_MARKER,
    expectInTerminal: true
  },
  {
    title: 'refuses a conversation missing from the shared store, since nothing can resume it',
    inStore: false,
    expectInPage: 'Orca could not find this Claude conversation in its transcript store',
    expectInTerminal: false
  }
] as const

for (const { title, inStore, expectInPage, expectInTerminal } of CASES) {
  test(`a restored Claude tab ${title}`, async ({
    flushRendererRecoveryEvidenceQueue
  }, testInfo) => {
    void flushRendererRecoveryEvidenceQueue
    const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    const session = createRestartSession(testInfo)
    const fakeClaude = writeFakeClaude()
    let firstApp: ElectronApplication | null = null
    let secondApp: ElectronApplication | null = null

    try {
      const firstLaunch = await session.launch()
      firstApp = firstLaunch.app
      const page = firstLaunch.page
      const appUserDataDir = await firstLaunch.app.evaluate(({ app }) => app.getPath('userData'))
      const { homeClaudeDir } = session.seedClaudeTranscriptStore({
        appUserDataDir,
        sessionId: PROVIDER_SESSION_ID,
        content: `${JSON.stringify({ type: 'user', text: CONVERSATION_MARKER })}\n`,
        inStore
      })
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

      // Why this path: the conversation ran on a managed account that no longer exists.
      const record: SleepingAgentSessionRecord = {
        paneKey,
        tabId: paneKey.split(':')[0]!,
        worktreeId,
        agent: 'claude',
        providerSession: {
          key: 'session_id',
          id: PROVIDER_SESSION_ID,
          transcriptPath: path.join(
            appUserDataDir,
            'claude-accounts',
            'acct-removed',
            'auth',
            'projects',
            '-e2e-repo',
            `${PROVIDER_SESSION_ID}.jsonl`
          )
        },
        prompt: '',
        state: 'working',
        capturedAt: Date.now(),
        updatedAt: Date.now(),
        origin: 'quit',
        launchConfig: { agentCommand: fakeClaude, agentArgs: '', agentEnv: {} }
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

      // Why: the pane's login shell resets HOME to the real one, so the default login's config
      // dir is named the way Orca forwards an inherited one, keeping the resume off real data.
      const secondLaunch = await session.launch({
        extraEnv: { CLAUDE_CONFIG_DIR: homeClaudeDir }
      })
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

      if (expectInTerminal) {
        await expect
          .poll(() => getTerminalContent(restored), {
            timeout: 30_000,
            message: 'the restored pane never showed the conversation it resumed'
          })
          .toContain(expectInPage)
        // No pin and no managed account is selected, so the resume ran where a new launch would:
        // the default login's config dir, whose projects/ links to the shared store.
        const terminal = await getTerminalContent(restored)
        expect(terminal).toContain(`RESUMED_IN=${homeClaudeDir}`)
        expect(terminal).not.toContain('acct-removed')
      } else {
        await expect
          .poll(() => restored.evaluate(() => document.body.innerText), {
            timeout: 30_000,
            message: 'the restored pane never refused the missing conversation'
          })
          .toContain(expectInPage)
        expect(await getTerminalContent(restored)).not.toContain('RESUMED_IN=')
      }
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
}
