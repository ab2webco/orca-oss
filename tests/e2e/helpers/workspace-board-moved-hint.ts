import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

/** Marks the board-moved hint seen and remounts the toolbar, so the bubble cannot cover the sidebar's lower rows in a capture. */
export async function dismissWorkspaceBoardMovedHint(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.setItem('orca.workspaceBoardMovedHintSeen.v1', 'true')
    window.__store!.getState().setSidebarOpen(false)
  })
  await expect(page.locator('[data-workspace-board-trigger]')).toHaveCount(0)
  await page.evaluate(() => window.__store!.getState().setSidebarOpen(true))
  await expect(page.locator('[data-workspace-board-trigger]')).toHaveCount(1)
}
