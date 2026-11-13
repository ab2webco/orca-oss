import { test, expect } from './helpers/orca-app'
import { getAllWorktreeIds, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'
import { writeSettings } from './helpers/settings-write'

// ORCA-1131: an unread row swapped its status glyph for a bell, so every member that had finished a
// turn read as needing you. As in V28 the glyph stays; unread shows in the title weight.
const WIDTHS = [1440, 768, 390, 320] as const
// The filled bell's path; the hover hint is the outline lucide bell, which never draws filled.
const FILLED_BELL_PATH = 'path[fill="currentColor"][fill-rule="evenodd"]'

test.describe('Unread sidebar row', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('keeps its status glyph and shows unread in the title, in Spanish', async ({
    orcaPage
  }, testInfo) => {
    const activeId = await waitForActiveWorktree(orcaPage)
    const unreadId = (await getAllWorktreeIds(orcaPage)).find((id) => id !== activeId)
    expect(unreadId, 'the seeded repo needs a second workspace').toBeTruthy()

    await writeSettings(orcaPage, { uiLanguage: 'es' })
    await orcaPage.evaluate((id) => {
      const state = window.__store!.getState()
      state.setSidebarOpen(true)
      state.setGroupBy('repo')
      state.updateWorktreeMeta(id, { isUnread: true })
    }, unreadId!)

    const row = worktreeRow(orcaPage, unreadId!)
    const statusSlot = row.locator('[data-worktree-card-status-slot]').first()
    await expect(row).toBeVisible()
    await expect(statusSlot.getByRole('button', { name: 'Marcar como leído' })).toBeVisible()
    await expect(statusSlot.locator(FILLED_BELL_PATH)).toHaveCount(0)
    await expect(row.locator('[data-worktree-title-inline-rename]').first()).toHaveClass(
      /font-semibold/
    )
    await expect(orcaPage.locator('[data-sidebar-section-title]')).toHaveText('Proyectos')

    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await expect(row).toBeVisible()
        await orcaPage.screenshot({ path: testInfo.outputPath(`unread-row-${theme}-${width}.png`) })
      }
    }
  })
})
