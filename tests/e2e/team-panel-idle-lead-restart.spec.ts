/**
 * ORCA-1130 D7: a lead idle at its prompt never reports agent status, and the Team panel still
 * shows the team after Orca restarts, with no prompt to wake it.
 *
 * Why a copied `sleep` named `claude`: the host restores a lead from the process in its pane, and
 * this one never sends a hook, so nothing but persisted state can name the lead.
 */

import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
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

type Leads = { leads: { handle: string; paneKey?: string }[] }
type StateLog = typeof globalThis & { __teamPanelStates?: string[] }

const TABS = ['Team', 'PRs', 'Queue'] as const

function fakeClaudeRunning(fakeDir: string): boolean {
  try {
    return execSync(`pgrep -f ${JSON.stringify(fakeDir)}`, { encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}

async function openTeamPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
}

async function expectTeamTabs(page: Page): Promise<void> {
  const panel = page.getByTestId('team-panel')
  for (const name of TABS) {
    await expect(panel.getByRole('tab', { name })).toBeVisible({ timeout: 30_000 })
  }
  await expect(panel).toHaveAttribute('data-team-panel-state', 'team')
}

// Why an observer: the no-team form can flash between loading and the team, and a poll misses it.
async function recordPanelStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = []
    ;(globalThis as StateLog).__teamPanelStates = log
    const note = (): void => {
      const state = document
        .querySelector('[data-testid="team-panel"]')
        ?.getAttribute('data-team-panel-state')
      if (state && log.at(-1) !== state) {
        log.push(state)
      }
    }
    note()
    new MutationObserver(note).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-team-panel-state']
    })
  })
}

test('the Team panel shows an idle lead’s team before and after Orca restarts', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(240_000)
  test.skip(process.platform === 'win32', 'The fake Claude is a copy of the POSIX sleep binary')
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const fakeDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-idle-lead-'))
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
      project: 'e2e-idle-lead',
      label: 'Ana',
      claim: true
    })
    expect(registered.result).toEqual({ registered: true })
    const listed = (await firstClient.call<Leads>('game.leads')).result.leads
    expect(listed).toEqual([expect.objectContaining({ handle: lead, paneKey })])

    // The lead never reported a status, so no agent status entry can name it.
    await openTeamPanel(first.page)
    await expectTeamTabs(first.page)
    await first.page.screenshot({ path: testInfo.outputPath('idle-lead-team-before.png') })

    await session.close(first.app)
    firstApp = null
    expect(fakeClaudeRunning(fakeDir)).toBe(true)

    const second = await session.launch()
    secondApp = second.app
    await recordPanelStates(second.page)
    await waitForSessionReady(second.page)
    await expectTeamTabs(second.page)
    const seen = await second.page.evaluate(() => (globalThis as StateLog).__teamPanelStates ?? [])
    testInfo.annotations.push({ type: 'panel states after restart', description: seen.join(' > ') })
    expect(seen).not.toContain('solo')
    expect(seen).not.toContain('unavailable')
    expect(seen.at(-1)).toBe('team')
    await second.page.screenshot({ path: testInfo.outputPath('idle-lead-team-after.png') })
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
