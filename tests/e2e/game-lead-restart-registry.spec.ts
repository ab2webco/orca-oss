/**
 * ORCA-654: a game lead whose pane survives an Orca restart is listed again with no `game lead`.
 *
 * Why a copied `sleep` named `claude`: the restore needs Claude in the pane's foreground, and the
 * process name is all Orca reads for that. It never reports a conversation, so this also covers a
 * lead restored before its session is known.
 */

import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId
} from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

type Leads = { leads: { project: string; label: string; handle: string; since: string }[] }

function fakeClaudeRunning(fakeDir: string): boolean {
  try {
    return execSync(`pgrep -f ${JSON.stringify(fakeDir)}`, { encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}

function rosterPaneKeys(userDataDir: string): string[] {
  const file = path.join(userDataDir, 'orchestrator-game-leads', 'live-leads.json')
  if (!existsSync(file)) {
    return []
  }
  const roster = JSON.parse(readFileSync(file, 'utf8')) as { leads: { paneKey: string }[] }
  return roster.leads.map((one) => one.paneKey)
}

test('lists a registered game lead again after Orca restarts', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(240_000)
  test.skip(process.platform === 'win32', 'The fake Claude is a copy of the POSIX sleep binary')
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const fakeDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-game-lead-'))
  const fakeClaude = path.join(fakeDir, 'claude')
  copyFileSync(execFileSync('which', ['sleep'], { encoding: 'utf8' }).trim(), fakeClaude)
  chmodSync(fakeClaude, 0o755)
  if (process.platform === 'darwin') {
    // Why: macOS kills a copied system binary until it carries a signature of its own.
    execFileSync('codesign', ['--force', '-s', '-', fakeClaude], { stdio: 'ignore' })
  }

  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null
  try {
    const first = await session.launch()
    firstApp = first.app
    await attachRepoAndOpenTerminal(first.page, repoPath)
    await waitForSessionReady(first.page)
    await ensureTerminalVisible(first.page)
    const ptyId = await waitForActivePanePtyId(first.page)
    const { paneKey } = await waitForActivePaneHookDescriptor(first.page)
    const firstClient = new RuntimeClient(session.userDataDir, 30_000, null, null)
    const lead = (
      await firstClient.call<{ terminal: { handle: string } }>('terminal.resolvePane', { paneKey })
    ).result.terminal.handle
    const { worktreeId } = (
      await firstClient.call<{ terminal: { worktreeId: string } }>('terminal.show', {
        terminal: lead
      })
    ).result.terminal
    // Why: until the runtime knows the worktree, the lead has no project and is never kept.
    await expect
      .poll(async () =>
        (
          await firstClient.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        ).result.worktrees.some((one) => one.id === worktreeId)
      )
      .toBe(true)

    await execInTerminal(first.page, ptyId, `${JSON.stringify(fakeClaude)} 900`)
    await expect.poll(() => fakeClaudeRunning(fakeDir), { timeout: 15_000 }).toBe(true)

    const registered = await firstClient.call<{ registered: boolean }>('game.leadRegister', {
      terminalHandle: lead,
      project: 'e2e-game',
      label: 'Ana',
      claim: true
    })
    expect(registered.result).toEqual({ registered: true })
    const before = (await firstClient.call<Leads>('game.leads')).result.leads
    expect(before).toEqual([expect.objectContaining({ project: 'e2e-game', handle: lead })])
    expect(rosterPaneKeys(session.userDataDir)).toEqual([paneKey])

    await session.close(first.app)
    firstApp = null
    expect(fakeClaudeRunning(fakeDir)).toBe(true)

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    const secondClient = new RuntimeClient(session.userDataDir, 30_000, null, null)

    await expect
      .poll(async () => (await secondClient.call<Leads>('game.leads')).result.leads, {
        timeout: 60_000
      })
      .toEqual([
        { project: 'e2e-game', label: 'Ana', handle: expect.any(String), since: before[0].since }
      ])
    const restored = (await secondClient.call<Leads>('game.leads')).result.leads[0].handle
    const paneNow = (
      await secondClient.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey
      })
    ).result.terminal.handle
    expect(restored).not.toBe(lead)
    expect(restored).toBe(paneNow)
    await second.page.screenshot({ path: testInfo.outputPath('restored-lead-pane.png') })
  } finally {
    if (secondApp) {
      await session.close(secondApp)
    }
    if (firstApp) {
      await session.close(firstApp)
    }
    await session.dispose()
    rmSync(fakeDir, { recursive: true, force: true })
  }
})
