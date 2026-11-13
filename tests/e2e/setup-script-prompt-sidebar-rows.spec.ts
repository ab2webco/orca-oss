import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

// ORCA-1131: the "Add a setup script" card floated over the sidebar list, so its last rows could
// not be reached even when scrolled to the bottom.
const EXTRA_WORKTREES = 14
const WIDTHS = [1440, 768, 390, 320] as const

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function createRepoWithoutSetupScript(repoPath: string, worktreesRoot: string): void {
  rmSync(repoPath, { recursive: true, force: true })
  rmSync(worktreesRoot, { recursive: true, force: true })
  mkdirSync(repoPath, { recursive: true })
  runGit(repoPath, ['init'])
  runGit(repoPath, ['config', 'user.email', 'e2e@test.local'])
  runGit(repoPath, ['config', 'user.name', 'E2E Test'])
  writeFileSync(path.join(repoPath, 'package.json'), '{ "name": "no-setup-script" }\n')
  runGit(repoPath, ['add', '-A'])
  runGit(repoPath, ['commit', '-m', 'Initial commit'])
  for (let index = 0; index < EXTRA_WORKTREES; index++) {
    const name = `row-${String(index).padStart(2, '0')}`
    runGit(repoPath, ['worktree', 'add', '-b', name, path.join(worktreesRoot, name)])
  }
}

async function addRepoWithAllWorktrees(page: Page, repoPath: string): Promise<string[]> {
  const repoId = await page.evaluate(async (targetRepoPath) => {
    const store = window.__store!
    const addedRepo = await store.getState().addRepoPath(targetRepoPath)
    if (!addedRepo) {
      throw new Error(`Failed to add repo at ${targetRepoPath}`)
    }
    await store.getState().updateRepo(addedRepo.id, { externalWorktreeVisibility: 'show' })
    return addedRepo.id
  }, repoPath)

  await expect
    .poll(
      () =>
        page.evaluate(async (targetRepoId) => {
          const store = window.__store!
          await store.getState().fetchWorktrees(targetRepoId)
          return store.getState().worktreesByRepo[targetRepoId]?.length ?? 0
        }, repoId),
      { timeout: 20_000, message: 'seeded worktrees did not load' }
    )
    .toBe(EXTRA_WORKTREES + 1)

  return page.evaluate((targetRepoId) => {
    const state = window.__store!.getState()
    const worktrees = state.worktreesByRepo[targetRepoId] ?? []
    state.setSidebarOpen(true)
    state.setGroupBy('none')
    state.setSortBy('name')
    state.setShowActiveOnly(false)
    state.setShowSleepingWorkspaces(true)
    state.setHideDefaultBranchWorkspace(false)
    state.setFilterRepoIds([targetRepoId])
    state.setActiveRepo(targetRepoId)
    state.setActiveWorktree(worktrees[0]!.id)
    return worktrees.map((entry) => entry.id)
  }, repoId)
}

/** The list's own scroll container, scrolled to the end. */
async function scrollSidebarListToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.worktree-sidebar-scrollbar')
    if (!viewport) {
      throw new Error('sidebar list viewport not found')
    }
    viewport.scrollTop = viewport.scrollHeight
  })
}

/** Bottom edge of the lowest worktree row actually rendered in the list. */
async function lowestRowBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-worktree-card-surface]')]
    return Math.max(...rows.map((row) => row.getBoundingClientRect().bottom))
  })
}

test.describe('Setup script prompt in the sidebar', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('leaves the last rows of the list reachable at every width', async ({
    orcaPage
  }, testInfo) => {
    const repoPath = testInfo.outputPath('no-setup-script-repo')
    createRepoWithoutSetupScript(repoPath, testInfo.outputPath('no-setup-script-worktrees'))
    await addRepoWithAllWorktrees(orcaPage, repoPath)

    const promptCard = orcaPage.locator('[data-setup-script-prompt-layer]')
    await expect(promptCard.getByText('Add a setup script')).toBeVisible({ timeout: 20_000 })

    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(orcaPage, { theme })
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await scrollSidebarListToBottom(orcaPage)
        await expect
          .poll(
            async () => {
              const cardTop = (await promptCard.boundingBox())?.y ?? 0
              return (await lowestRowBottom(orcaPage)) - cardTop
            },
            { message: `the card covers the last row at ${width}px (${theme})` }
          )
          .toBeLessThanOrEqual(1)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`setup-card-rows-${theme}-${width}.png`)
        })
      }
    }
  })
})
