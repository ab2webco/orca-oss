import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

const ACTIVATION_TIMEOUT_MS = 30_000
const TRANSIENT_CONTEXT_ERRORS = [
  'Execution context was destroyed',
  'Target closed',
  'Target page, context or browser has been closed',
  'frame was detached'
]

function isTransientContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT_CONTEXT_ERRORS.some((fragment) => message.includes(fragment))
}

/**
 * A lazy chunk loading during startup replaces the renderer's execution context,
 * and `expect.poll` awaits its generator outside its own try/catch — so a throw
 * there fails the test instead of being retried. Retry the evaluate itself.
 */
export async function evaluateThroughContextSwaps<T>(
  page: Page,
  run: () => Promise<T>,
  what: string
): Promise<T> {
  const deadline = Date.now() + ACTIVATION_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await run()
    } catch (error) {
      if (!isTransientContextError(error)) {
        throw error
      }
      lastError = error
      await page.waitForTimeout(250)
    }
  }
  throw new Error(
    `${what} kept losing the renderer execution context: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}

/**
 * Registers an out-of-tree repo and activates its worktree through the same
 * public store path real repo setup uses, so diff specs can stage isolated
 * fixtures without touching the shared seeded repo.
 */
export async function addAndActivateIsolatedRepo(page: Page, repoPath: string): Promise<string> {
  const repoId = await evaluateThroughContextSwaps(
    page,
    () =>
      page.evaluate(async (pathToRepo: string) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is not available')
        }

        const addedRepo = await store.getState().addRepoPath(pathToRepo)
        if (!addedRepo) {
          throw new Error(`isolated repo not found: ${pathToRepo}`)
        }

        return addedRepo.id
      }, repoPath),
    'adding the isolated repo'
  )

  // Why: fetchWorktrees() resolves before Zustand always reflects the async
  // worktree scan, so poll the store instead of trusting the first read.
  await expect
    .poll(
      () =>
        evaluateThroughContextSwaps(
          page,
          () =>
            page.evaluate(async (targetRepoId: string) => {
              const store = window.__store
              if (!store) {
                return 0
              }
              await store.getState().fetchWorktrees(targetRepoId)
              return store.getState().worktreesByRepo[targetRepoId]?.length ?? 0
            }, repoId),
          'scanning the isolated worktree'
        ),
      {
        timeout: ACTIVATION_TIMEOUT_MS,
        message: 'isolated diff worktree did not load'
      }
    )
    .toBeGreaterThan(0)

  return evaluateThroughContextSwaps(
    page,
    () =>
      page.evaluate(
        ({ targetRepoId, pathToRepo }) => {
          const store = window.__store
          if (!store) {
            throw new Error('window.__store is not available')
          }

          const state = store.getState()
          const worktrees = state.worktreesByRepo[targetRepoId] ?? []
          const worktree = worktrees.find((entry) => entry.path === pathToRepo) ?? worktrees[0]
          if (!worktree) {
            throw new Error(`isolated worktree not found: ${pathToRepo}`)
          }
          state.setActiveRepo(targetRepoId)
          state.setActiveWorktree(worktree.id)
          return worktree.id
        },
        { targetRepoId: repoId, pathToRepo: repoPath }
      ),
    'activating the isolated worktree'
  )
}
