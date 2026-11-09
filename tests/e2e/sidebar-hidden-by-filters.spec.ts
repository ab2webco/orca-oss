/**
 * ORCA-1149 S5: V30's "N hidden by filters · View filters" line under the worktree list.
 * It counts what the filters hide (never archived worktrees) and its link opens the
 * workspace options menu, which holds the filters.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function seedWorktrees(page: Page): Promise<{ defaultBranchId: string }> {
  return page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const repo = state.repos[0]
    const current = repo ? (state.worktreesByRepo[repo.id] ?? [])[0] : undefined
    if (!repo || !current) {
      throw new Error('Hidden-by-filters E2E needs a seeded repo and worktree')
    }
    const defaultBranchId = 'e2e-hidden-by-filters-main'
    const featureId = 'e2e-hidden-by-filters-feature'
    const archivedId = 'e2e-hidden-by-filters-archived'
    store.setState((prev) => ({
      worktreesByRepo: {
        ...prev.worktreesByRepo,
        [repo.id]: [
          { ...current, displayName: 'Current workspace', isMainWorktree: false },
          {
            ...current,
            id: defaultBranchId,
            displayName: 'Default branch workspace',
            isMainWorktree: true,
            branch: 'refs/heads/main'
          },
          {
            ...current,
            id: featureId,
            displayName: 'Feature workspace',
            isMainWorktree: false,
            branch: 'refs/heads/feature'
          },
          {
            ...current,
            id: archivedId,
            displayName: 'Archived workspace',
            isMainWorktree: false,
            isArchived: true,
            branch: 'refs/heads/archived'
          }
        ]
      }
    }))
    const next = store.getState()
    next.setActiveView('terminal')
    next.setSidebarOpen(true)
    next.setGroupBy('none')
    next.setFilterRepoIds([])
    return { defaultBranchId }
  })
}

// Poll rather than set once: hydration can land after the seed and reset the filters.
async function setFilters(page: Page, hideDefaultBranch: boolean): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((hide) => {
        const state = window.__store?.getState()
        state?.setShowSleepingWorkspaces(true)
        state?.setHideDefaultBranchWorkspace(hide)
        return state?.hideDefaultBranchWorkspace ?? null
      }, hideDefaultBranch)
    )
    .toBe(hideDefaultBranch)
}

test.describe('Sidebar hidden-by-filters line', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('counts what the filters hide and opens the filters', async ({ orcaPage }, testInfo) => {
    const { defaultBranchId } = await seedWorktrees(orcaPage)
    const line = orcaPage.locator('[data-sidebar-hidden-by-filters]')

    await setFilters(orcaPage, false)
    await expect(worktreeRow(orcaPage, defaultBranchId)).toBeVisible()
    await expect(line).toHaveCount(0)

    // Only the default branch is filtered; the archived worktree is hidden by no filter.
    await setFilters(orcaPage, true)
    await expect(worktreeRow(orcaPage, defaultBranchId)).toHaveCount(0)
    await expect(line).toHaveAttribute('data-sidebar-hidden-by-filters', '1')
    await expect(line).toContainText('1 ')

    await line.getByRole('button').click()
    await expect(orcaPage.getByRole('menu')).toBeVisible()
    await orcaPage.keyboard.press('Escape')
    await expect(orcaPage.getByRole('menu')).toHaveCount(0)
    // Why: Escape hands focus back to the menu trigger, whose tooltip would sit on the captures.
    await orcaPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await orcaPage.mouse.move(700, 400)

    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 720 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const where = `${width}px ${theme}`
        await expect(line, `hidden line at ${where}`).toBeVisible()
        const overflow = await line.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `hidden line overflows at ${where}`).toBeLessThanOrEqual(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`hidden-by-filters-${width}-${theme}.png`)
        })
      }
    }
  })
})
