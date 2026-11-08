/**
 * ORCA-1130 D9: after two turns, Activity's Final is the second turn's last message, with the
 * plugin system off and on.
 *
 * Why real /hook/claude events: the stale Final came from how the store keeps one completed message
 * per pane, which only the real server, listener and renderer row exercise together.
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor } from './helpers/terminal'
import { openTeamPanel, postClaudeHook } from './helpers/idle-lead-restart'

const SESSION = 'e2e-d9-session'

for (const plugins of ['off', 'on'] as const) {
  test(`Activity's Final is the last finished turn after two turns (plugins ${plugins})`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const pluginRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-d9-plugin-'))
    try {
      await waitForSessionReady(orcaPage)
      await ensureTerminalVisible(orcaPage)
      const pane = await waitForActivePaneHookDescriptor(orcaPage)
      if (plugins === 'on') {
        const pluginDir = path.join(pluginRoot, 'hello-orca')
        cpSync(path.join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginDir, {
          recursive: true
        })
        const statuses = await orcaPage.evaluate(async (dir) => {
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
        expect(statuses).toEqual([expect.stringMatching(/^(idle|running)$/)])
      }

      const endpoint = await readHookEndpoint(electronApp)
      const turn = async (n: number, final: string): Promise<void> => {
        await postClaudeHook(endpoint, pane, {
          hook_event_name: 'UserPromptSubmit',
          session_id: SESSION,
          prompt: `Turn ${n}`
        })
        await postClaudeHook(endpoint, pane, {
          hook_event_name: 'Stop',
          session_id: SESSION,
          last_assistant_message: final
        })
      }
      await turn(1, 'First turn finished.')
      await turn(2, 'Second turn finished.')
      await expect
        .poll(() =>
          orcaPage.evaluate((key) => {
            const entry = window.__store?.getState().agentStatusByPaneKey[key]
            return entry ? [entry.state, entry.lastAssistantMessage] : null
          }, pane.paneKey)
        )
        .toEqual(['done', 'Second turn finished.'])

      await openTeamPanel(orcaPage)
      const selected = orcaPage.getByTestId('team-panel').locator('[data-team-activity="selected"]')
      await expect(selected).toContainText('Turn 2', { timeout: 30_000 })
      await expect(selected).toContainText('Second turn finished.')
      await expect(selected).not.toContainText('First turn finished.')
      await orcaPage.screenshot({ path: testInfo.outputPath('activity-final.png') })
    } finally {
      rmSync(pluginRoot, { recursive: true, force: true })
    }
  })
}
