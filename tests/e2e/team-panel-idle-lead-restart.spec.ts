/**
 * ORCA-1130 D7: a lead idle at its prompt never reports agent status, and the Team panel still
 * shows the team after Orca restarts, with no prompt to wake it.
 *
 * Why a copied `sleep` named `claude`: the host restores a lead from the process in its pane, and
 * this one never sends a hook, so nothing but persisted state can name the lead.
 */

import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  createFakeClaude,
  expectTeamTabs,
  openTeamPanel,
  readPanelStates,
  recordPanelStates,
  startIdleLead
} from './helpers/idle-lead-restart'

type Leads = { leads: { handle: string; paneKey?: string }[] }

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

  const fake = createFakeClaude()
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
      project: 'e2e-idle-lead'
    })
    const listed = (await lead.client.call<Leads>('game.leads')).result.leads
    expect(listed).toEqual([
      expect.objectContaining({ handle: lead.handle, paneKey: lead.paneKey })
    ])

    // The lead never reported a status, so no agent status entry can name it.
    await openTeamPanel(first.page)
    await expectTeamTabs(first.page)
    await first.page.screenshot({ path: testInfo.outputPath('idle-lead-team-before.png') })

    await session.close(first.app)
    firstApp = null
    expect(fake.running()).toBe(true)

    const second = await session.launch()
    secondApp = second.app
    await recordPanelStates(second.page)
    await waitForSessionReady(second.page)
    await expectTeamTabs(second.page)
    const seen = await readPanelStates(second.page)
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
    fake.dispose()
  }
})
