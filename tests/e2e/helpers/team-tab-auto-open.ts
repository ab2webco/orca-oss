import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

/**
 * Waits for the Team panel a lead start opens (ORCA-1414), then closes the right sidebar.
 * Why: a spec that opens the panel on a team it built first expects that open's fresh read; a
 * panel already open since the lead start shows the lead-only read until its next 20 s poll.
 */
export async function closeLeadStartTeamPanel(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__store!.getState()
          return state.rightSidebarOpen && state.rightSidebarTab === 'team'
        }),
      { message: 'the lead start never opened the Team panel' }
    )
    .toBe(true)
  await page.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
}
