import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

type CombinedDiffScrollRepo = {
  repoPath: string
}

type ViewportAnchor = {
  key: string
  index: number
  top: number
  bottom: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

type ScrollProbeSample = {
  scrollHeight: number
  scrollTop: number
}

const FILE_COUNT = 18
const ADDED_LINES_PER_FILE = 180

function runGit(repoPath: string, args: string[]): void {
  execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' })
}

function buildBaseFile(fileIndex: number): string {
  return `${Array.from(
    { length: 20 },
    (_, lineIndex) => `export const base_${fileIndex}_${lineIndex} = ${lineIndex}`
  ).join('\n')}\n`
}

function buildModifiedFile(fileIndex: number): string {
  const added = Array.from(
    { length: ADDED_LINES_PER_FILE },
    (_, lineIndex) => `export const changed_${fileIndex}_${lineIndex} = ${fileIndex + lineIndex}`
  ).join('\n')
  return `${buildBaseFile(fileIndex)}${added}\n`
}

function createCombinedDiffScrollRepo(): CombinedDiffScrollRepo {
  const repoPath = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-combined-diff-scroll-')))
  runGit(repoPath, ['init'])
  runGit(repoPath, ['config', 'user.email', 'e2e@test.local'])
  runGit(repoPath, ['config', 'user.name', 'E2E Test'])

  const srcDir = path.join(repoPath, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (let index = 0; index < FILE_COUNT; index += 1) {
    writeFileSync(
      path.join(srcDir, `scroll-${String(index).padStart(2, '0')}.ts`),
      buildBaseFile(index)
    )
  }
  runGit(repoPath, ['add', '-A'])
  runGit(repoPath, ['commit', '-m', 'Initial combined diff scroll fixture'])

  for (let index = 0; index < FILE_COUNT; index += 1) {
    writeFileSync(
      path.join(srcDir, `scroll-${String(index).padStart(2, '0')}.ts`),
      buildModifiedFile(index)
    )
  }

  return { repoPath }
}

async function addAndActivateRepo(page: Page, repoPath: string): Promise<string> {
  const repoId = await page.evaluate(async (pathToRepo: string) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }

    const addedRepo = await store.getState().addRepoPath(pathToRepo)
    if (!addedRepo) {
      throw new Error(`isolated combined-diff repo not found: ${pathToRepo}`)
    }
    return addedRepo.id
  }, repoPath)

  await expect
    .poll(
      () =>
        page.evaluate(async (targetRepoId: string) => {
          const store = window.__store
          if (!store) {
            return 0
          }
          await store.getState().fetchWorktrees(targetRepoId)
          return store.getState().worktreesByRepo[targetRepoId]?.length ?? 0
        }, repoId),
      {
        timeout: 30_000,
        message: 'isolated combined-diff worktree did not load'
      }
    )
    .toBeGreaterThan(0)

  return page.evaluate(
    ({ targetRepoId, pathToRepo }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }

      const state = store.getState()
      const worktrees = state.worktreesByRepo[targetRepoId] ?? []
      const worktree = worktrees.find((entry) => entry.path === pathToRepo) ?? worktrees[0]
      if (!worktree) {
        throw new Error(`isolated combined-diff worktree not found: ${pathToRepo}`)
      }
      state.setActiveRepo(targetRepoId)
      state.setActiveWorktree(worktree.id)
      return worktree.id
    },
    { targetRepoId: repoId, pathToRepo: repoPath }
  )
}

async function openCombinedDiff(page: Page, worktreeId: string, repoPath: string): Promise<string> {
  return page.evaluate(
    async ({ wId, pathToRepo }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      const status = await window.api.git.status({ worktreePath: pathToRepo })
      const entries = status.entries.filter((entry) => entry.area === 'unstaged')
      if (entries.length < 2) {
        throw new Error(`expected multiple unstaged entries, received ${entries.length}`)
      }
      state.setGitStatus(wId, status)
      state.openAllDiffs(wId, pathToRepo, undefined, 'unstaged', entries)

      const nextState = store.getState()
      const activeGroupId = nextState.activeGroupIdByWorktree[wId]
      const activeFileId = nextState.activeFileId
      const tab = (nextState.unifiedTabsByWorktree[wId] ?? []).find(
        (candidate) => candidate.groupId === activeGroupId && candidate.entityId === activeFileId
      )
      if (!tab) {
        throw new Error('combined diff tab was not created')
      }
      return tab.id
    },
    { wId: worktreeId, pathToRepo: repoPath }
  )
}

// Why: teleporting straight to 7000px leaves the jumped-over sections
// unrendered, so they never get a measured Monaco height. Their later
// estimated→measured swap can then land after a tab-switch restore has already
// pinned the anchor, shifting the viewport with nothing left to re-pin it —
// which reads as a restore miss on slow runners. Descend one viewport at a
// time and let each band's sections measure so everything above the final
// position has settled geometry before any anchor is captured.
async function scrollCombinedDiffDeep(page: Page): Promise<void> {
  let previousTop = -1
  for (;;) {
    const step = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('.combined-diff-scroll-container')
      if (!container) {
        throw new Error('combined diff scroll container not found')
      }
      const target = Math.min(
        7_000,
        Math.max(0, container.scrollHeight - container.clientHeight - 1)
      )
      const next = Math.min(target, container.scrollTop + container.clientHeight)
      container.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: next - container.scrollTop
        })
      )
      container.scrollTop = next
      container.dispatchEvent(new Event('scroll', { bubbles: true }))
      return { top: container.scrollTop, target }
    })
    await waitForMeasuredContentHeight(page, `descending at ${step.top}px`, 3)
    if (step.top >= step.target || step.top === previousTop) {
      return
    }
    previousTop = step.top
  }
}

async function readViewportAnchor(page: Page): Promise<ViewportAnchor | null> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.combined-diff-scroll-container')
    if (!container) {
      return null
    }
    const containerRect = container.getBoundingClientRect()
    const visibleRows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-combined-diff-section-row]')
    )
      .map((row) => {
        const rect = row.getBoundingClientRect()
        const key = row.dataset.combinedDiffSectionKey
        const index = Number(row.dataset.index)
        if (
          !key ||
          !Number.isFinite(index) ||
          rect.height <= 0 ||
          rect.bottom <= containerRect.top ||
          rect.top >= containerRect.bottom
        ) {
          return null
        }
        return {
          key,
          index,
          top: rect.top - containerRect.top,
          bottom: rect.bottom - containerRect.top,
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight
        }
      })
      .filter((row): row is ViewportAnchor => row !== null)
      .sort((a, b) => a.top - b.top)
    return visibleRows[0] ?? null
  })
}

const CONTENT_HEIGHT_QUIET_SAMPLES = 6
const CONTENT_HEIGHT_SAMPLE_INTERVAL_MS = 200

// Why: Monaco diff editors swap estimated section heights for measured ones in
// async passes after (re)mount, so a moving scrollHeight means the layout is
// still mid-measurement and any anchor read is a transient frame. Holding for
// a quiet content height pins the anchor comparison to the measured layout
// instead of a lucky sample window, without loosening the anchor tolerances.
async function waitForMeasuredContentHeight(
  page: Page,
  context: string,
  requiredQuietSamples = CONTENT_HEIGHT_QUIET_SAMPLES
): Promise<number> {
  const startedAt = Date.now()
  let lastHeight = -1
  let quietSamples = 0
  const observedHeights: number[] = []

  while (Date.now() - startedAt < 30_000) {
    const height = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('.combined-diff-scroll-container')
      return container ? container.scrollHeight : -1
    })
    if (height > 0 && height === lastHeight) {
      quietSamples += 1
      if (quietSamples >= requiredQuietSamples) {
        return height
      }
    } else {
      observedHeights.push(height)
      quietSamples = 0
      lastHeight = height
    }
    await page.waitForTimeout(CONTENT_HEIGHT_SAMPLE_INTERVAL_MS)
  }

  throw new Error(
    `combined diff content height never settled (${context}); observed: ${observedHeights
      .slice(-20)
      .join(' -> ')}`
  )
}

async function waitForStableViewportAnchor(page: Page): Promise<ViewportAnchor> {
  const startedAt = Date.now()
  let lastSignature = ''
  let stableSamples = 0
  let lastAnchor: ViewportAnchor | null = null

  while (Date.now() - startedAt < 15_000) {
    const anchor = await readViewportAnchor(page)
    if (anchor) {
      const signature = `${anchor.key}:${Math.round(anchor.top)}:${Math.round(
        anchor.bottom
      )}:${Math.round(anchor.scrollHeight)}`
      if (signature === lastSignature) {
        stableSamples += 1
        if (stableSamples >= 2) {
          return anchor
        }
      } else {
        lastSignature = signature
        stableSamples = 0
      }
      lastAnchor = anchor
    }
    await page.waitForTimeout(100)
  }

  throw new Error(`combined diff viewport anchor did not settle: ${JSON.stringify(lastAnchor)}`)
}

// Why: remounting the diff on tab switch restores scroll in several Monaco
// layout passes, so the first settled anchor can be a mid-restore frame. Hold
// for a measured (height-quiet) layout first, then poll until the anchor
// converges near the pre-switch offset before asserting; a genuine restore
// miss still surfaces because the last anchor is returned on timeout for the
// caller's assertion to fail on.
async function waitForRestoredViewportAnchor(
  page: Page,
  target: ViewportAnchor,
  tolerancePx = 80
): Promise<ViewportAnchor> {
  await waitForMeasuredContentHeight(page, 'after switching back to the diff tab')
  // Why: waitForStableViewportAnchor can take up to 15s; start the restoration
  // poll after it settles so a slow first settle does not skip the 10s window.
  let lastAnchor = await waitForStableViewportAnchor(page)
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10_000) {
    if (lastAnchor.key === target.key && Math.abs(lastAnchor.top - target.top) < tolerancePx) {
      return lastAnchor
    }
    await page.waitForTimeout(100)
    const anchor = await readViewportAnchor(page)
    if (anchor) {
      lastAnchor = anchor
    }
  }
  return lastAnchor
}

async function startCombinedDiffScrollProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type CombinedDiffScrollProbe = {
      samples: ScrollProbeSample[]
      stop: () => void
    }
    const targetWindow = window as typeof window & {
      __combinedDiffScrollProbe?: CombinedDiffScrollProbe
    }
    targetWindow.__combinedDiffScrollProbe?.stop()

    const container = document.querySelector<HTMLElement>('.combined-diff-scroll-container')
    if (!container) {
      throw new Error('combined diff scroll container not found')
    }

    const samples: ScrollProbeSample[] = []
    const record = (): void => {
      samples.push({
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop
      })
    }
    container.addEventListener('scroll', record, { passive: true })
    record()
    targetWindow.__combinedDiffScrollProbe = {
      samples,
      stop: () => container.removeEventListener('scroll', record)
    }
  })
}

async function stopCombinedDiffScrollProbe(page: Page): Promise<ScrollProbeSample[]> {
  return page.evaluate(() => {
    type CombinedDiffScrollProbe = {
      samples: ScrollProbeSample[]
      stop: () => void
    }
    const targetWindow = window as typeof window & {
      __combinedDiffScrollProbe?: CombinedDiffScrollProbe
    }
    const probe = targetWindow.__combinedDiffScrollProbe
    if (!probe) {
      return []
    }
    probe.stop()
    delete targetWindow.__combinedDiffScrollProbe
    return probe.samples
  })
}

async function wheelCombinedDiffDown(page: Page): Promise<ScrollProbeSample[]> {
  const container = page.locator('.combined-diff-scroll-container')
  const box = await container.boundingBox()
  if (!box) {
    throw new Error('combined diff scroll container bounds not found')
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await startCombinedDiffScrollProbe(page)
  for (let index = 0; index < 12; index += 1) {
    await page.mouse.wheel(0, 520)
    await page.waitForTimeout(35)
  }
  await page.waitForTimeout(400)
  return stopCombinedDiffScrollProbe(page)
}

function getLargestBackwardScrollJump(samples: readonly ScrollProbeSample[]): number {
  let largestBackwardJump = 0
  for (let index = 1; index < samples.length; index += 1) {
    // Why: a backward scrollTop delta that coincides with a scrollHeight change
    // is the virtualizer correcting for lazily-measured diff editors above the
    // viewport (expected under CI-timed Monaco measurement), not a scroll-restore
    // anchoring regression. A real regression moves scrollTop at a stable content
    // height, so only those backward jumps count.
    if (samples[index].scrollHeight !== samples[index - 1].scrollHeight) {
      continue
    }
    largestBackwardJump = Math.max(
      largestBackwardJump,
      samples[index - 1].scrollTop - samples[index].scrollTop
    )
  }
  return largestBackwardJump
}

async function clickVisibleDiffLine(page: Page): Promise<void> {
  // Why: after a tab switch Monaco re-lays-out its virtualized diff lines
  // asynchronously, so the visible .view-line set is briefly empty on a loaded
  // CI runner. Poll until a line is painted in the viewport instead of reading
  // it once and throwing on the first miss.
  let linePoint: { x: number; y: number } | null = null
  await expect
    .poll(
      async () => {
        linePoint = await page.evaluate(() => {
          const container = document.querySelector<HTMLElement>('.combined-diff-scroll-container')
          if (!container) {
            return null
          }
          const containerRect = container.getBoundingClientRect()
          const visibleLine = Array.from(
            container.querySelectorAll<HTMLElement>('.monaco-diff-editor .view-line')
          ).find((line) => {
            const rect = line.getBoundingClientRect()
            return (
              rect.height > 0 &&
              rect.bottom > containerRect.top &&
              rect.top < containerRect.bottom &&
              rect.right > containerRect.left &&
              rect.left < containerRect.right
            )
          })
          if (!visibleLine) {
            return null
          }
          const rect = visibleLine.getBoundingClientRect()
          return {
            x: rect.left + Math.min(12, Math.max(1, rect.width / 2)),
            y: rect.top + rect.height / 2
          }
        })
        return linePoint !== null
      },
      { timeout: 10_000, message: 'visible combined diff line not found' }
    )
    .toBe(true)

  if (!linePoint) {
    throw new Error('visible combined diff line not found')
  }
  await page.mouse.click(linePoint.x, linePoint.y)
}

test.describe('Combined diff scroll restore', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ seedTestRepo: false })

  test('keeps the visible section anchored after switching tabs', async ({ orcaPage }) => {
    // Why: the measured stepped descent adds bounded arrange time on loaded CI
    // runners; the assertion tolerances are unchanged, only the budget grows.
    test.slow()
    await waitForSessionReady(orcaPage)
    const fixture = createCombinedDiffScrollRepo()

    try {
      const worktreeId = await addAndActivateRepo(orcaPage, fixture.repoPath)
      const diffTabId = await openCombinedDiff(orcaPage, worktreeId, fixture.repoPath)
      await expect(orcaPage.locator('.combined-diff-scroll-container')).toBeVisible()
      await expect(orcaPage.getByText(`${FILE_COUNT} changed files`)).toBeVisible()

      await scrollCombinedDiffDeep(orcaPage)
      await waitForStableViewportAnchor(orcaPage)
      const activeScrollSamples = await wheelCombinedDiffDown(orcaPage)
      expect(activeScrollSamples.length).toBeGreaterThan(2)
      expect(
        getLargestBackwardScrollJump(activeScrollSamples),
        `backward scroll jump at a stable content height; samples=${JSON.stringify(
          activeScrollSamples
        )}`
      ).toBeLessThan(120)

      // Why: the pre-switch anchor is the comparison target; capturing it while
      // Monaco is still swapping estimated heights for measured ones would pin
      // the restore assertion to a frame the viewer itself never persisted.
      await waitForMeasuredContentHeight(orcaPage, 'before switching tabs')
      const beforeSwitch = await waitForStableViewportAnchor(orcaPage)
      expect(beforeSwitch.index).toBeGreaterThan(0)

      await orcaPage.evaluate((wId) => {
        const store = window.__store
        if (!store) {
          throw new Error('window.__store is not available')
        }
        store.getState().createTab(wId)
      }, worktreeId)
      await expect(orcaPage.locator('.combined-diff-scroll-container')).toHaveCount(0)

      await orcaPage.locator(`[data-tab-id="${diffTabId}"]`).click({ force: true })
      await expect(orcaPage.locator('.combined-diff-scroll-container')).toBeVisible()
      const afterSwitch = await waitForRestoredViewportAnchor(orcaPage, beforeSwitch)

      expect(afterSwitch.key).toBe(beforeSwitch.key)
      // Why: this failure is CI-only so far; keep both anchors in the message
      // so a remote red carries the geometry needed to diagnose it.
      expect(
        Math.abs(afterSwitch.top - beforeSwitch.top),
        `restore drift; before=${JSON.stringify(beforeSwitch)} after=${JSON.stringify(afterSwitch)}`
      ).toBeLessThan(80)

      await clickVisibleDiffLine(orcaPage)
      const afterLineClick = await waitForStableViewportAnchor(orcaPage)

      // Assert the viewport barely moved rather than an exact anchor key: sections
      // are ~viewport-sized, so a sub-pixel focus scroll from the click can flip the
      // topmost-visible key by one without meaningfully moving the scroll position.
      // Why the message carries both anchors: a bare number cannot tell an anchoring
      // regression from the two movements this file already documents as legitimate — a
      // changed `key` (:534) or a `scrollHeight` swap (:538). Same payload as the restore
      // assertion above, so the next red arrives with the geometry instead of a guess.
      expect(
        Math.abs(afterLineClick.top - afterSwitch.top),
        `line-click drift; afterSwitch=${JSON.stringify(afterSwitch)} afterLineClick=${JSON.stringify(afterLineClick)}`
      ).toBeLessThan(80)
      // Why: when a section above the viewport swaps its estimated height for
      // Monaco's measured one, scrollHeight changes and Chromium's default
      // scroll anchoring (no `overflow-anchor: none` here) legitimately moves
      // raw scrollTop to keep the row above asserted `top` pinned — that is
      // not an anchoring regression, so only cap scrollTop drift when content
      // height held steady (same rule as getLargestBackwardScrollJump above).
      if (afterLineClick.scrollHeight === afterSwitch.scrollHeight) {
        expect(Math.abs(afterLineClick.scrollTop - afterSwitch.scrollTop)).toBeLessThan(40)
      }
    } finally {
      rmSync(fixture.repoPath, { recursive: true, force: true })
    }
  })
})
