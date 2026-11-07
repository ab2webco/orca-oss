import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { emitCodexHookStatus, readHookEndpoint } from './agent-hook-endpoint'

export type TeamInbox = { panel: Locator; inboxTab: Locator; inbox: Locator }

/**
 * Posts the lead pane's agent row the way Orca's hooks do. The Team panel finds its lead through
 * that row, and a pane without a real agent never posts one.
 */
export async function postLeadAgentRow(
  electronApp: ElectronApplication,
  lead: { paneKey: string; worktreeId: string }
): Promise<void> {
  const endpoint = await readHookEndpoint(electronApp)
  await emitCodexHookStatus(endpoint, { ...lead, state: 'working', prompt: 'Lead the team' })
}

/** Opens the Team panel on its Inbox tab, where every question for the person lives. */
export async function openTeamInbox(page: Page): Promise<TeamInbox> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarTab('team')
    state.setRightSidebarOpen(true)
  })
  const panel = page.getByTestId('team-panel')
  const inboxTab = panel.getByRole('tab', { name: /Inbox|Bandeja/ })
  await expect(inboxTab).toBeVisible({ timeout: 90_000 })
  await inboxTab.click()
  await expect(inboxTab).toHaveAttribute('aria-selected', 'true')
  return { panel, inboxTab, inbox: panel.getByTestId('team-panel-inbox') }
}
