import { renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

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
      .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })

  rmSync(originalPath, { force: true })
  rmSync(renamedPath, { force: true })
  try {
    await expect(row('README.md')).toBeVisible({ timeout: 10_000 })
    await orcaPage.waitForTimeout(2_000)

    // TEMPORARY (ORCA-197): record the watcher payloads the renderer actually
    // receives, so a missing row can be attributed to a dropped event vs a
    // reconcile that saw the event and still did not re-read the directory.
    await orcaPage.evaluate(() => {
      const sink = (window as Window & { __orcaE2eFsChanged?: unknown[] }).__orcaE2eFsChanged ?? []
      ;(window as Window & { __orcaE2eFsChanged?: unknown[] }).__orcaE2eFsChanged = sink
      window.api.fs.onFsChanged((payload) => {
        sink.push({ at: Date.now(), payload })
      })
    })
    const dumpWatchEvents = async (): Promise<string> =>
      JSON.stringify(
        await orcaPage.evaluate(
          () => (window as Window & { __orcaE2eFsChanged?: unknown[] }).__orcaE2eFsChanged ?? []
        )
      )

    writeFileSync(originalPath, 'created outside Orca\n')
    await expect(row(originalName)).toBeVisible({ timeout: 10_000 })

    renameSync(originalPath, renamedPath)
    try {
      await expect(row(renamedName)).toBeVisible({ timeout: 10_000 })
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\nfs:changed payloads: ${await dumpWatchEvents()}`
      )
    }
    await expect(row(originalName)).toHaveCount(0, { timeout: 10_000 })

    rmSync(renamedPath)
    await expect(row(renamedName)).toHaveCount(0, { timeout: 10_000 })
  } finally {
    rmSync(originalPath, { force: true })
    rmSync(renamedPath, { force: true })
  }
})
