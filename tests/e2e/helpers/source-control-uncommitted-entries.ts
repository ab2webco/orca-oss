import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

const SOURCE_CONTROL_QUIET_SAMPLES = 4
const SOURCE_CONTROL_SAMPLE_INTERVAL_MS = 250
const SOURCE_CONTROL_SETTLE_TIMEOUT_MS = 20_000

/**
 * Why: the composer is seeded into the store first, then the real git status
 * and branch-compare land a few hundred ms later and re-render the panel. A
 * test that asserts on the first frame races that swap for the rest of its
 * steps — on a loaded runner the swap arrives mid-assertion, which is how CI
 * ended up matching the same filename in Staged Changes *and* in Committed on
 * Branch. Hold for a quiet row count so the panel under test is the settled
 * one; the observed counts travel with the timeout for remote diagnosis.
 */
export async function waitForSettledSourceControlRows(
  page: Page,
  worktreeId: string
): Promise<void> {
  const startedAt = Date.now()
  const observed: string[] = []
  let lastSignature = ''
  let quietSamples = 0

  while (Date.now() - startedAt < SOURCE_CONTROL_SETTLE_TIMEOUT_MS) {
    const signature = await page.evaluate((targetWorktreeId) => {
      const state = window.__store?.getState()
      const uncommitted = state?.gitStatusByWorktree?.[targetWorktreeId] ?? []
      const branch = state?.gitBranchChangesByWorktree?.[targetWorktreeId] ?? []
      return `${uncommitted.length}/${branch.length}`
    }, worktreeId)

    if (signature === lastSignature) {
      quietSamples += 1
      if (quietSamples >= SOURCE_CONTROL_QUIET_SAMPLES) {
        return
      }
    } else {
      observed.push(signature)
      quietSamples = 0
      lastSignature = signature
    }
    await page.waitForTimeout(SOURCE_CONTROL_SAMPLE_INTERVAL_MS)
  }

  throw new Error(
    `Source Control rows never settled for ${worktreeId}; observed uncommitted/branch counts: ${observed.join(' -> ')}`
  )
}

/**
 * Why: `getByText(filename)` is ambiguous by construction — the branch-compare
 * section renders the same filename once the file is also committed on the
 * branch, and Playwright strict mode then fails with a locator error that
 * reads like a missing file. Scope to the uncommitted-changes row the AI
 * composer actually acts on.
 */
export async function expectUncommittedSourceControlEntry(
  page: Page,
  worktreeId: string,
  filename: string
): Promise<void> {
  await waitForSettledSourceControlRows(page, worktreeId)
  await expect(page.getByTestId('source-control-entry').filter({ hasText: filename })).toHaveCount(
    1,
    { timeout: 10_000 }
  )
}
