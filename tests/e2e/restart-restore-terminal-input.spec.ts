/**
 * Repro spec for the "starts frozen right after an update" report
 * (Discord #performance, GitHub #2836 family).
 *
 * Field evidence: after an app update + relaunch the terminal pane shows
 * restored content but typing produces nothing — daemon output.log never
 * grows. Restore paints the persisted buffer synchronously BEFORE the
 * deferred PTY reattach runs (use-terminal-pane-lifecycle.ts →
 * pty-connection.ts), and every reattach-failure branch swallows into null,
 * so a failed/stalled attach leaves a live-looking, input-dead pane.
 *
 * Existing coverage (daemon-live-session-preservation.spec.ts,
 * terminal-restart-persistence.spec.ts) asserts restored CONTENT after
 * relaunch, but never that INPUT still works. These tests close that gap for
 * three real relaunch shapes:
 *   1. clean restart with a live daemon session (the update model)
 *   2. daemon wedged (SIGSTOP) across the relaunch — the attach stalls while
 *      restore has already painted; input must recover once the daemon does
 *   3. daemon killed between launches — cold-restore + fresh spawn must yield
 *      a typeable pane
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import {
  discoverActivePtyId,
  execInTerminal,
  getTerminalContent,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import {
  buildFrozenPaneReport,
  getStorePtyIds,
  probeDirectWrite,
  probeKeyboardType,
  probeOwnershipRebuildRevival
} from './helpers/terminal-input-probes'
import {
  collectPaneBindingDiagnostics,
  waitForLiveBoundPanePtyId
} from './helpers/terminal-pane-pty-binding'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import { PROTOCOL_VERSION } from '../../src/main/daemon/types'
import { PTY_SESSION_ID_SEPARATOR } from '../../src/shared/pty-session-id-format'

const REQUIRE_WINDOWS_TERMINAL_RESTART_E2E =
  process.env.ORCA_REQUIRE_WINDOWS_TERMINAL_RESTART_E2E === '1'

function readDaemonPid(userDataDir: string): number {
  const raw = readFileSync(
    path.join(userDataDir, 'daemon', `daemon-v${PROTOCOL_VERSION}.pid`),
    'utf8'
  )
  const parsed = JSON.parse(raw) as { pid?: unknown }
  if (typeof parsed.pid !== 'number') {
    throw new Error(`Daemon pid file did not contain a numeric pid: ${raw}`)
  }
  return parsed.pid
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    throw error
  }
}

async function terminateDaemonForColdRestart(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    return
  }
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'pipe',
        timeout: 10_000
      })
    } catch (error) {
      if (isProcessAlive(pid)) {
        throw error
      }
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      // Why: the daemon can self-exit between the liveness guard and this
      // signal; tolerate ESRCH like the Windows branch re-checks liveness.
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error
      }
    }
  }
  await expect
    .poll(() => isProcessAlive(pid), {
      timeout: 10_000,
      message: `daemon ${pid} remained alive after forced termination`
    })
    .toBe(false)
}

function seededRepoPathOrSkip(): string {
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
    : ''
  const unavailable = !repoPath || !existsSync(repoPath)
  if (unavailable && REQUIRE_WINDOWS_TERMINAL_RESTART_E2E) {
    throw new Error('Required Windows restart E2E seeded repo is unavailable')
  }
  test.skip(unavailable, 'Global setup did not produce a seeded test repo')
  return repoPath
}

async function bootstrapFirstLaunch(
  page: Page,
  repoPath: string
): Promise<{ ptyId: string; marker: string }> {
  await attachRepoAndOpenTerminal(page, repoPath)
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  await waitForPaneCount(page, 1, 30_000)
  const ptyId = await discoverActivePtyId(page)
  // Why: the separator only appears in daemon session ids. If e2e silently
  // ran the local provider, these tests would exercise the wrong restore path.
  expect(ptyId, 'expected a daemon-backed PTY session').toContain(PTY_SESSION_ID_SEPARATOR)
  const marker = `RESTORE_INPUT_PRE_${Date.now()}`
  await execInTerminal(page, ptyId, `echo ${marker}`)
  await waitForTerminalOutput(page, marker)
  return { ptyId, marker }
}

async function settleRestoredLaunch(page: Page): Promise<void> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  await waitForPaneCount(page, 1, 30_000)
}

/**
 * The shared assertion: a restored pane must accept input. Reports layer
 * discrimination when it doesn't.
 */
async function expectRestoredPaneAcceptsInput(page: Page, context: string): Promise<void> {
  // Why: the probe target is the pane's OWN binding, not a one-shot store
  // snapshot. A cold restore re-spawns the session, so the store id read before
  // the rebind names a corpse and every probe against it reports a false
  // freeze — the shape this spec failed with on CI for 4 consecutive runs.
  const probePtyId = await waitForLiveBoundPanePtyId(page, 30_000)
  const readinessAlive =
    probePtyId !== null && (await waitForRestoredTerminalInputReady(page, probePtyId, 15_000))
  // Why: type unconditionally. Gating this on readiness printed `transport
  // dead` without ever typing, so one stale target read as three dead layers.
  const kbAlive = await probeKeyboardType(page, 'KB_RESTORED_OK', 15_000)
  const directAlive =
    probePtyId !== null && (await probeDirectWrite(page, probePtyId, 'DIRECT_RESTORED_OK', 15_000))
  const ptyIds = await getStorePtyIds(page)
  if (!readinessAlive || !kbAlive || !directAlive) {
    const ownershipRebuildAttempted = !directAlive && probePtyId !== null
    const revived =
      ownershipRebuildAttempted &&
      (await probeOwnershipRebuildRevival(page, probePtyId, 'REVIVED_RESTORED_OK'))
    throw new Error(
      buildFrozenPaneReport(context, {
        directAlive,
        transportAlive: kbAlive,
        revivedByOwnershipRebuild: revived,
        ownershipRebuildAttempted,
        readinessAlive,
        probePtyId,
        ptyIds,
        binding: await collectPaneBindingDiagnostics(page),
        terminalTail: await getTerminalContent(page)
      })
    )
  }
  // Why: a live pane whose id never reaches the store is a real product defect
  // (activity dots and orphan cleanup read the store), so assert convergence
  // separately instead of letting it masquerade as a frozen pane.
  expect(ptyIds, `store did not adopt the pane's bound PTY id (${context})`).toContain(probePtyId)
}

test.describe.configure({ mode: 'serial' })

test('restored pane accepts typing after a clean restart with a live daemon session', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = seededRepoPathOrSkip()
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    const { marker } = await bootstrapFirstLaunch(first.page, repoPath)
    const daemonPid = readDaemonPid(session.userDataDir)

    await session.close(firstApp)
    firstApp = null

    const second = await session.launch()
    secondApp = second.app
    await settleRestoredLaunch(second.page)
    await waitForTerminalOutput(second.page, marker, 15_000)
    expect(readDaemonPid(session.userDataDir), 'daemon must survive the restart').toBe(daemonPid)

    await expectRestoredPaneAcceptsInput(second.page, 'clean restart, live daemon session')
  } finally {
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
  }
})

test('restored pane recovers input after the daemon un-wedges', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.skip(process.platform === 'win32', 'SIGSTOP/SIGCONT are POSIX-only')
  test.setTimeout(300_000)
  const repoPath = seededRepoPathOrSkip()
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  let stoppedDaemonPid: number | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    const { marker } = await bootstrapFirstLaunch(first.page, repoPath)
    const daemonPid = readDaemonPid(session.userDataDir)

    await session.close(firstApp)
    firstApp = null

    // Wedge the daemon: it stays alive (socket exists, sessions retained) but
    // cannot accept or answer — the shape of a busy/hung daemon during launch.
    process.kill(daemonPid, 'SIGSTOP')
    stoppedDaemonPid = daemonPid

    const second = await session.launch()
    secondApp = second.app
    await settleRestoredLaunch(second.page)

    // Field-fidelity check, not a hard gate: does the pane paint restored
    // content while its PTY attach cannot complete? That visible-but-dead
    // window is exactly what the reporter sees at startup.
    const paintedWhileWedged = (await getTerminalContent(second.page)).includes(marker)

    // The relaunching app may classify the stopped daemon as unreachable and
    // kill+replace it (daemon hardening) — then SIGCONT throws ESRCH and the
    // old sessions are gone. Both shapes must leave the pane typeable, so
    // record which one we're in and keep probing.
    let daemonReplacedWhileWedged = false
    try {
      process.kill(daemonPid, 'SIGCONT')
    } catch {
      daemonReplacedWhileWedged = true
    }
    stoppedDaemonPid = null

    await expectRestoredPaneAcceptsInput(
      second.page,
      `daemon wedged during relaunch (painted while wedged: ${paintedWhileWedged}, ` +
        `wedged daemon killed+replaced by relaunch: ${daemonReplacedWhileWedged})`
    )
  } finally {
    if (stoppedDaemonPid !== null) {
      try {
        process.kill(stoppedDaemonPid, 'SIGCONT')
      } catch {
        // daemon already gone
      }
    }
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
  }
})

test('cold-restored pane accepts typing after the daemon died between launches', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = seededRepoPathOrSkip()
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    await bootstrapFirstLaunch(first.page, repoPath)
    const daemonPid = readDaemonPid(session.userDataDir)

    await session.close(firstApp)
    firstApp = null

    // The daemon dies uncleanly between runs (crash, reboot, force-kill). The
    // persisted session now references sessions no living daemon holds.
    await terminateDaemonForColdRestart(daemonPid)

    const second = await session.launch()
    secondApp = second.app
    await settleRestoredLaunch(second.page)

    await expectRestoredPaneAcceptsInput(second.page, 'daemon killed between launches')
  } finally {
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
  }
})
