import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

function readPersistedRightSidebarOpen(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => window.api.ui.get().then((ui) => ui.rightSidebarOpen))
}

test.describe('right sidebar close vs. UI state broadcast', () => {
  // Why: main re-broadcasts the whole persisted UI on any write. One landing inside the
  // renderer's 150ms persist debounce (in CI, the window-bounds save after a resize) used to
  // re-hydrate the stale rightSidebarOpen=true and undo the close (ORCA-805).
  test('a close survives an unrelated UI write inside the persist debounce', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarOpen(true))
    // Let the open persist so main's copy is the stale value the close must win against.
    await expect.poll(() => readPersistedRightSidebarOpen(orcaPage)).toBe(true)

    await orcaPage.evaluate(async () => {
      window.__store?.getState().setRightSidebarOpen(false)
      // Must change a value: main skips the broadcast for a no-op write.
      await window.api.ui.set({ lastUpdateCheckAt: Date.now() })
    })

    await expect.poll(() => readPersistedRightSidebarOpen(orcaPage)).toBe(false)
    expect(await orcaPage.evaluate(() => window.__store?.getState().rightSidebarOpen)).toBe(false)
  })
})
