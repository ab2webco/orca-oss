import { rmSync, writeFileSync } from 'node:fs'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { addAndActivateIsolatedRepo } from './helpers/isolated-diff-repo-activation'
import {
  buildRevisionedSourceFile,
  createIsolatedRevisionedFileRepo
} from './large-diff-repro-fixtures'
import { MAX_INLINE_RENDERED_DELETED_LINES } from '../../src/renderer/src/components/editor/inline-diff-deleted-line-budget'

const FIXTURE_LINE_COUNT = MAX_INLINE_RENDERED_DELETED_LINES * 3
const ORDINARY_CHANGED_LINE_COUNT = 20
// Why: Monaco renders roughly eight nodes per deleted line into an inline view
// zone, so the unguarded rewrite materializes tens of thousands. A viewport-sized
// render stays in the hundreds; this sits far above one and far below the other.
const MAX_RENDERED_VIEW_LINES = 1_000

type DiffRenderObservation = {
  layout: string
  editors: number
  viewLines: number
  deletedZones: number
}

async function openDiffAndObserve(
  page: Page,
  worktreeId: string,
  absolutePath: string,
  relativePath: string
): Promise<DiffRenderObservation> {
  await page.evaluate(
    ({ wId, filePath, relPath }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openDiff(wId, filePath, relPath, 'typescript', false)
    },
    { wId: worktreeId, filePath: absolutePath, relPath: relativePath }
  )

  const read = (): Promise<DiffRenderObservation> =>
    page.evaluate(() => ({
      layout:
        document
          .querySelector('[data-diff-render-layout]')
          ?.getAttribute('data-diff-render-layout') ?? '',
      editors: document.querySelectorAll('.monaco-diff-editor').length,
      viewLines: document.querySelectorAll('.monaco-diff-editor .view-line').length,
      deletedZones: document.querySelectorAll('.monaco-diff-editor .line-delete').length
    }))

  await expect
    .poll(async () => (await read()).editors, {
      timeout: 60_000,
      message: 'the diff editor never mounted'
    })
    .toBeGreaterThan(0)

  // Why: inline view zones are built after first mount, so a single read right
  // after the editor appears can miss the DOM this budget exists to bound.
  await page.waitForTimeout(3_000)
  return read()
}

test.describe('Inline diff deleted-line render budget', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ seedTestRepo: false })

  test('a rewrite past the budget renders side by side instead of materializing every deleted line', async ({
    orcaPage
  }) => {
    test.setTimeout(180_000)
    await waitForSessionReady(orcaPage)
    const fixture = createIsolatedRevisionedFileRepo(FIXTURE_LINE_COUNT)

    try {
      const worktreeId = await addAndActivateIsolatedRepo(orcaPage, fixture.repoPath)
      writeFileSync(
        fixture.absolutePath,
        buildRevisionedSourceFile(FIXTURE_LINE_COUNT, FIXTURE_LINE_COUNT)
      )

      const observation = await openDiffAndObserve(
        orcaPage,
        worktreeId,
        fixture.absolutePath,
        fixture.relativePath
      )
      expect(observation.layout).toBe('side-by-side')
      expect(observation.deletedZones).toBe(0)
      expect(observation.viewLines).toBeLessThan(MAX_RENDERED_VIEW_LINES)
    } finally {
      rmSync(fixture.repoPath, { recursive: true, force: true })
    }
  })

  test('an ordinary edit in a file of the same size still renders inline', async ({ orcaPage }) => {
    test.setTimeout(180_000)
    await waitForSessionReady(orcaPage)
    const fixture = createIsolatedRevisionedFileRepo(FIXTURE_LINE_COUNT)

    try {
      const worktreeId = await addAndActivateIsolatedRepo(orcaPage, fixture.repoPath)
      writeFileSync(
        fixture.absolutePath,
        buildRevisionedSourceFile(FIXTURE_LINE_COUNT, ORDINARY_CHANGED_LINE_COUNT)
      )

      const observation = await openDiffAndObserve(
        orcaPage,
        worktreeId,
        fixture.absolutePath,
        fixture.relativePath
      )
      expect(observation.layout).toBe('inline')
      // Why: the inline layout is only proven by the deleted lines it renders as
      // view zones; asserting the attribute alone would pass on an empty diff.
      expect(observation.deletedZones).toBeGreaterThan(0)
    } finally {
      rmSync(fixture.repoPath, { recursive: true, force: true })
    }
  })
})
