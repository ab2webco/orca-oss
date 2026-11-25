/**
 * ORCA-1402: `orca game state` from a live lead's pane listed its members and no leader, so the Team
 * panel showed the no-team hint. The host files a lead's agent row under its tab's worktree and read
 * only the worktree the caller named; when the two differed, the lead was in neither.
 */

import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { createRestartSession } from './helpers/orca-restart'
import { emitClaudeHookPayload, readHookEndpoint } from './helpers/agent-hook-endpoint'
import {
  createFakeClaude,
  expectTeamTabs,
  openTeamPanel,
  startIdleLead
} from './helpers/idle-lead-restart'

type State = { role: string; agents: { paneKey: string; isLeader: boolean; state: string }[] }

test('game.state from a lead pane names it leader when its row is filed under another worktree', async ({
  flushRendererRecoveryEvidenceQueue
}, testInfo) => {
  void flushRendererRecoveryEvidenceQueue
  test.setTimeout(180_000)
  test.skip(process.platform === 'win32', 'The fake Claude is a copy of the POSIX sleep binary')
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath || !existsSync(repoPath), 'Global setup did not produce a seeded test repo')

  const fake = createFakeClaude()
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    const lead = await startIdleLead({
      page,
      userDataDir: session.userDataDir,
      repoPath,
      fake,
      project: 'e2e-lead-row-elsewhere'
    })
    // Why a reported prompt: an idle lead with no row is drawn by another path (ORCA-1130).
    const endpoint = await readHookEndpoint(app)
    await emitClaudeHookPayload(endpoint, {
      paneKey: lead.paneKey,
      worktreeId: lead.worktreeId,
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'launch the team' }
    })
    const leaderOf = async (worktreeId: string) =>
      (
        await lead.client.call<State>('game.state', {
          worktreeId,
          terminalHandle: lead.handle,
          paneKey: lead.paneKey
        })
      ).result.agents.find((one) => one.isLeader) ?? null

    // Guard: from its own worktree the lead is listed with the state it reported.
    await expect
      .poll(() => leaderOf(lead.worktreeId), { timeout: 15_000 })
      .toMatchObject({ paneKey: lead.paneKey, state: 'working' })

    const { repoId } = (
      await lead.client.call<{ worktrees: { id: string; repoId: string }[] }>('worktree.list', {})
    ).result.worktrees.find((one) => one.id === lead.worktreeId)!
    const other = (
      await lead.client.call<{ worktree: { id: string } }>('worktree.create', {
        repo: `id:${repoId}`,
        name: `wt-other-${Date.now()}`,
        noParent: true,
        activate: false
      })
    ).result.worktree.id
    expect(other).not.toBe(lead.worktreeId)

    expect(await leaderOf(other)).toMatchObject({ paneKey: lead.paneKey, state: 'working' })

    await openTeamPanel(page)
    await expectTeamTabs(page)
    await page.screenshot({ path: testInfo.outputPath('lead-row-other-worktree-team.png') })
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    fake.dispose()
  }
})
