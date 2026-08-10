import { renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

/**
 * The tree refresh itself was never the flake (ORCA-198).
 *
 * A file explorer row renders the file name AND its git decoration badge inside
 * the same `[data-file-explorer-row]` button, so the row's own text goes from
 * `WATCH-REFRESH-CASE.txt` to `WATCH-REFRESH-CASE.txtU` a few hundred ms after
 * the row appears. This spec used to anchor on that whole-row text
 * (`/^WATCH-REFRESH-CASE\.txt$/`), so the locator matched zero elements from the
 * moment the decoration landed and only passed when Playwright happened to poll
 * inside the gap — 2 of 4 scheduled runs lost that race and reported
 * "element(s) not found" while the tree was showing the renamed file.
 *
 * Assert on the name cell, which carries the file name and nothing else, and
 * hold one assertion past the decoration so the whole-row form cannot come back.
 */

const NAME_CELL = '[data-file-explorer-row-name]'

function exactly(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

test('refreshes the visible tree after external Windows file changes', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarOpen(false))
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store?.getState().rightSidebarOpen))
    .toBe(false)
  await openFileExplorer(orcaPage)

  const worktreePath = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    if (!state || !worktreeId) {
      throw new Error('active worktree unavailable')
    }
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => candidate.id === worktreeId)
    if (!worktree) {
      throw new Error('active worktree path unavailable')
    }
    return worktree.path
  })

  const originalName = 'watch-refresh-case.txt'
  const renamedName = 'WATCH-REFRESH-CASE.txt'
  const originalPath = path.join(worktreePath, originalName)
  const renamedPath = path.join(worktreePath, renamedName)
  const row = (name: string) =>
    orcaPage
      .locator('[data-file-explorer-row]')
      .filter({ has: orcaPage.locator(NAME_CELL).filter({ hasText: exactly(name) }) })

  rmSync(originalPath, { force: true })
  rmSync(renamedPath, { force: true })
  try {
    await expect(row('README.md')).toBeVisible({ timeout: 10_000 })
    await orcaPage.waitForTimeout(2_000)

    writeFileSync(originalPath, 'created outside Orca\n')
    await expect(row(originalName)).toBeVisible({ timeout: 10_000 })

    // A case-only rename on a case-sensitive filesystem reaches the renderer as
    // create + delete of two paths that differ only in case; the tree must
    // re-read the directory and swap the row.
    renameSync(originalPath, renamedPath)
    await expect(row(renamedName)).toBeVisible({ timeout: 10_000 })
    // Why: the row is decorated with its git status badge shortly after it
    // appears, which is what pushed the row's own text off the anchored form.
    // Hold here until the decoration lands: `row()` must still resolve there.
    await expect(row(renamedName)).not.toHaveText(exactly(renamedName), { timeout: 10_000 })
    await expect(row(originalName)).toHaveCount(0, { timeout: 10_000 })

    rmSync(renamedPath)
    await expect(row(renamedName)).toHaveCount(0, { timeout: 10_000 })
  } finally {
    rmSync(originalPath, { force: true })
    rmSync(renamedPath, { force: true })
  }
})
