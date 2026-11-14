import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import { expect } from './orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './terminal'

/** Registers the active pane as a live lead and opens the Team panel on its team. */
export async function openTeamPanelWithLead(
  electronApp: ElectronApplication,
  page: Page
): Promise<{ worktreeId: string; repoId: string }> {
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActivePanePtyId(page)
  const pane = await waitForActivePaneHookDescriptor(page)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  // Why a foreground process: a lead pane back at its shell is not a live lead.
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(async () => {
      const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
        terminalHandle: lead,
        project: 'e2e',
        label: 'Alfred'
      })
      return registered.result.registered
    })
    .toBe(true)
  const repoId = await page.evaluate((id) => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
    return state.getKnownWorktreeById(id)?.repoId ?? ''
  }, worktreeId)
  await expect(page.getByTestId('team-panel')).toHaveAttribute('data-team-panel-state', 'team', {
    timeout: 60_000
  })
  return { worktreeId, repoId }
}
