/**
 * ORCA-1216 §9: the line under the worktree list names each filter that hides rows, with a
 * count each ("4 hidden: 3 detached HEAD · 1 CLI-created"), and Show reveals those rows
 * inline, dimmed and in their usual place, until Hide puts them back. Archived worktrees are
 * never counted: no filter hides them.
 */

import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'
import { worktreeRow } from './worktree-row-locators'

const PREFIX = 'e2e-hidden-by-filters-'
const WIDTHS = [1440, 768, 390, 320]
const DETACHED_IDS = [`${PREFIX}detached-a`, `${PREFIX}detached-b`, `${PREFIX}detached-c`]
// Detached and CLI-created at once: counted once, under CLI, the earlier filter.
const CLI_DETACHED_ID = `${PREFIX}cli-detached`
const FEATURE_ID = `${PREFIX}feature`
const ARCHIVED_ID = `${PREFIX}archived`
const HIDDEN_IDS = [...DETACHED_IDS, CLI_DETACHED_ID]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function seedWorktrees(page: Page): Promise<void> {
  await page.evaluate(
    ({ prefix, detachedIds, cliDetachedId, featureId, archivedId }) => {
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
      const row = (id: string, displayName: string) => ({
        ...current,
        id,
        path: `${current.path}-${id.slice(prefix.length)}`,
        displayName,
        isMainWorktree: false,
        isArchived: false,
        branch: `refs/heads/${id.slice(prefix.length)}`
      })
      const detachedNames = ['Alpha detached', 'Charlie detached', 'Delta detached']
      const detached = (id: string, index: number) => ({
        ...row(id, detachedNames[index] ?? `Detached ${index}`),
        branch: '',
        head: `deadbeef${index}cafe0000`
      })
      const detachedRows = detachedIds.map(detached)
      store.setState((prev) => ({
        worktreesByRepo: {
          ...prev.worktreesByRepo,
          [repo.id]: [
            { ...current, displayName: 'Current workspace', isMainWorktree: false },
            ...detachedRows,
            // Sorts between hidden rows by name, so "in place" cannot pass by appending at the end.
            row(featureId, 'Bravo feature'),
            {
              ...detached(cliDetachedId, 9),
              displayName: 'Echo CLI',
              cliProvenance: { kind: 'created-by-cli' as const, createdAt: Date.now() }
            },
            { ...detached(archivedId, 8), displayName: 'Archived workspace', isArchived: true }
          ]
        }
      }))
      const next = store.getState()
      next.setActiveView('terminal')
      next.setSidebarOpen(true)
      next.setGroupBy('none')
      next.setSortBy('name')
      next.setFilterRepoIds([])
    },
    {
      prefix: PREFIX,
      detachedIds: DETACHED_IDS,
      cliDetachedId: CLI_DETACHED_ID,
      featureId: FEATURE_ID,
      archivedId: ARCHIVED_ID
    }
  )
}

// Poll rather than set once: hydration can land after the seed and reset the filters.
async function setFilters(page: Page, hide: boolean): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((on) => {
        const state = window.__store?.getState()
        state?.setShowSleepingWorkspaces(true)
        state?.setHideDetachedHeadWorkspaces(on)
        state?.setHideCliCreatedWorkspaces(on)
        const after = window.__store?.getState()
        return after ? after.hideDetachedHeadWorkspaces && after.hideCliCreatedWorkspaces : null
      }, hide)
    )
    .toBe(hide)
}

async function seededRowOrder(page: Page): Promise<string[]> {
  return page
    .locator('[role="option"][data-worktree-id]')
    .evaluateAll(
      (nodes, prefix) =>
        nodes
          .map((node) => node.getAttribute('data-worktree-id') ?? '')
          .filter((id) => id.startsWith(prefix)),
      PREFIX
    )
}

async function captureWidths(
  page: Page,
  line: Locator,
  state: 'collapsed' | 'revealed',
  outputPath: (name: string) => string
): Promise<void> {
  const sidebarWidthFor = (width: number): number => (width >= 1440 ? 470 : width > 320 ? 280 : 220)
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 760 })
    // Why close the right panel at phone widths: it overlays the left sidebar there.
    await page.evaluate(
      ({ sidebarWidth, rightOpen }) => {
        const store = window.__store!.getState()
        store.setSidebarWidth(sidebarWidth)
        store.setRightSidebarOpen(rightOpen)
      },
      { sidebarWidth: sidebarWidthFor(width), rightOpen: width > 390 }
    )
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      const where = `${width}px ${theme} ${state}`
      await expect(line, `hidden line at ${where}`).toBeVisible()
      const overflow = await line.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `hidden line overflows at ${where}`).toBeLessThanOrEqual(0)
      const actionOnTop = await line.getByRole('button').evaluate((button) => {
        const box = button.getBoundingClientRect()
        return (
          document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button
        )
      })
      expect(actionOnTop, `the action is covered at ${where}`).toBe(true)
      if (width >= 768) {
        // One row: the action sits on the same line as the breakdown.
        const rows = await line.evaluate((node) => {
          const first = node.firstElementChild
          const last = node.lastElementChild
          return first && last && first !== last
            ? Math.abs(first.getBoundingClientRect().top - last.getBoundingClientRect().top)
            : -1
        })
        expect(rows, `hidden line wraps at ${where}`).toBeGreaterThanOrEqual(0)
        expect(rows, `hidden line wraps at ${where}`).toBeLessThanOrEqual(2)
      }
      await page.mouse.move(1000, 600)
      await page.screenshot({
        animations: 'disabled',
        path: outputPath(`hidden-by-filters-${state}-${width}-${theme}.png`)
      })
    }
  }
}

test.describe('Sidebar hidden-by-filters line', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('names the filters that hide rows and reveals them inline, dimmed', async ({
    orcaPage
  }, testInfo) => {
    await orcaPage.setViewportSize({ width: 1440, height: 760 })
    await seedWorktrees(orcaPage)
    await dismissWorkspaceBoardMovedHint(orcaPage)
    const line = orcaPage.locator('[data-sidebar-hidden-by-filters]')

    await setFilters(orcaPage, false)
    for (const id of HIDDEN_IDS) {
      await expect(worktreeRow(orcaPage, id)).toBeVisible()
    }
    await expect(line).toHaveCount(0)
    const unfilteredOrder = await seededRowOrder(orcaPage)
    expect(unfilteredOrder).toEqual([
      DETACHED_IDS[0],
      FEATURE_ID,
      DETACHED_IDS[1],
      DETACHED_IDS[2],
      CLI_DETACHED_ID
    ])

    await setFilters(orcaPage, true)
    for (const id of HIDDEN_IDS) {
      await expect(worktreeRow(orcaPage, id)).toHaveCount(0)
    }
    await expect(worktreeRow(orcaPage, FEATURE_ID)).toBeVisible()
    await expect(line).toHaveAttribute('data-sidebar-hidden-by-filters', '4')
    await expect(line).toContainText('4 hidden: 3 detached HEAD · 1 CLI-created')
    const action = line.getByRole('button')
    await expect(action).toHaveText('Show')
    await captureWidths(orcaPage, line, 'collapsed', (name) => testInfo.outputPath(name))

    await orcaPage.setViewportSize({ width: 1440, height: 760 })
    await action.click()
    await expect(action).toHaveText('Hide')
    await expect(action).toHaveAttribute('aria-pressed', 'true')
    // The count still says what the filters hide; revealing does not change it.
    await expect(line).toHaveAttribute('data-sidebar-hidden-by-filters', '4')
    for (const id of HIDDEN_IDS) {
      const revealed = worktreeRow(orcaPage, id)
      await expect(revealed).toBeVisible()
      await expect(revealed).toHaveAttribute('data-sidebar-revealed-hidden', 'true')
      const opacity = await revealed.evaluate((node) => Number(getComputedStyle(node).opacity))
      expect(opacity, `${id} is dimmed`).toBeLessThan(1)
    }
    await expect(worktreeRow(orcaPage, FEATURE_ID)).not.toHaveAttribute(
      'data-sidebar-revealed-hidden',
      'true'
    )
    expect(await seededRowOrder(orcaPage), 'revealed rows sit in their usual place').toEqual(
      unfilteredOrder
    )
    await captureWidths(orcaPage, line, 'revealed', (name) => testInfo.outputPath(name))

    await orcaPage.setViewportSize({ width: 1440, height: 760 })
    await action.click()
    await expect(action).toHaveText('Show')
    for (const id of HIDDEN_IDS) {
      await expect(worktreeRow(orcaPage, id)).toHaveCount(0)
    }
    await expect(worktreeRow(orcaPage, FEATURE_ID)).toBeVisible()

    await setFilters(orcaPage, false)
    await expect(line).toHaveCount(0)
  })
})
