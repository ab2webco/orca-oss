import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

// Why: two frames at 60Hz. The switch commits inside the click task, so a
// budget a user could read as a dropped frame is the regression to catch.
const MAX_CLICK_TASK_DURATION_MS = 32
const MAX_CLICK_BACK_TIMER_DRIFT_MS = 32

// Why (ORCA-222): both budgets above used to be asserted on ONE main-thread
// sample, and on a shared 4-core CI runner one OS preemption is
// indistinguishable from product jank — 1/56 runs read timerDriftMs 47.1
// against 32 with no product change behind it. So the switch is sampled N
// times and the budgets are asserted on the SECOND-WORST sample: exactly one
// starvation spike per run is tolerated, a second one is not. A regression
// blocks every switch, so it lands on all N. The ceilings are unchanged —
// raising them is what would have deleted the signal, see
// docs/reference/timing-budget-assertions.md.
// Not the median: local runs put the median ~2ms against 32, so a 16x margin
// on a statistic 4 of 7 samples have to cross makes the ceiling inert.
// Second-worst measured 1.9-3.1ms over 12 local rounds — the 32 still binds.
const SWITCH_SAMPLES = 7
// Why: catastrophic-hang detectors, not budgets — a single sample must not be
// able to decide the run at the 32 level again. 500 is ~10x the worst drift CI
// has ever produced here (47.1); 150 is ~35x the worst click task measured over
// 140 local samples (4.2). The second-worst assertions above carry the budget;
// these only exist so a switch that wedges the main thread outright still fails
// on its own sample.
const MAX_SAMPLE_TIMER_DRIFT_MS = 500
const MAX_SAMPLE_CLICK_TASK_DURATION_MS = 150

const CLICK_BACK_TIMER_DELAY_MS = 120
const SELECTION_QUIET_WINDOW_MS = 700

type VisibleState = {
  firstCurrent: string | null
  secondCurrent: string | null
  renderedWorktreeId: string | null
}

type SwitchSample = {
  before: VisibleState
  afterFirstClick: VisibleState & { clickDurationMs: number }
  afterSecondClick: VisibleState & { clickDurationMs: number; timerDriftMs: number }
  afterQuietWindow: VisibleState
}

/** Highest value after discarding the single worst sample. */
function secondWorst(values: readonly number[]): number {
  const descending = [...values].sort((a, b) => b - a)
  return descending[1] ?? descending[0]
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

async function prepareSidebarForSwitchTest(page: Page): Promise<[string, string]> {
  return page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }

    const state = store.getState()
    state.setActiveView('terminal')
    state.setSidebarOpen(true)
    state.setGroupBy('none')
    state.setSortBy('recent')
    state.setShowActiveOnly(false)
    state.setShowSleepingWorkspaces(true)
    state.setHideDefaultBranchWorkspace(false)
    state.setFilterRepoIds([])

    const repo = state.repos[0]
    const worktrees = repo ? (state.worktreesByRepo[repo.id] ?? []) : []
    if (worktrees.length < 2) {
      throw new Error('Worktree switch responsiveness test needs at least two worktrees')
    }

    const [first, second] = worktrees
    if ((state.tabsByWorktree[second.id] ?? []).length === 0) {
      state.createTab(second.id, undefined, undefined, { pendingActivationSpawn: true })
    }
    state.revealWorktreeInSidebar(first.id, { behavior: 'auto' })
    state.revealWorktreeInSidebar(second.id, { behavior: 'auto' })
    state.setActiveWorktree(first.id)
    return [first.id, second.id]
  })
}

async function measureSwitchSamples(
  page: Page,
  firstWorktreeId: string,
  secondWorktreeId: string
): Promise<SwitchSample[]> {
  return page.evaluate(
    async ({ firstId, secondId, timerDelayMs, quietWindowMs, sampleCount }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }

      const option = (id: string): HTMLElement => {
        const element = [...document.querySelectorAll<HTMLElement>('[data-worktree-id]')].find(
          (candidate) => candidate.dataset.worktreeId === id
        )
        if (!element) {
          throw new Error(`Missing worktree option for ${id}`)
        }
        return element
      }
      const surface = (id: string): HTMLElement => {
        const element = option(id).querySelector<HTMLElement>('[data-worktree-card-surface]')
        if (!element) {
          throw new Error(`Missing worktree card surface for ${id}`)
        }
        return element
      }
      const visibleState = () => ({
        firstCurrent: option(firstId).getAttribute('aria-current'),
        secondCurrent: option(secondId).getAttribute('aria-current'),
        renderedWorktreeId:
          document
            .querySelector('[data-rendered-active-worktree-id]')
            ?.getAttribute('data-rendered-active-worktree-id') ?? null
      })

      const samples: {
        before: ReturnType<typeof visibleState>
        afterFirstClick: ReturnType<typeof visibleState> & { clickDurationMs: number }
        afterSecondClick: ReturnType<typeof visibleState> & {
          clickDurationMs: number
          timerDriftMs: number
        }
        afterQuietWindow: ReturnType<typeof visibleState>
      }[] = []

      for (let sample = 0; sample < sampleCount; sample += 1) {
        // Why: setActiveWorktree only arms the deferred terminal prep on a
        // worktree's first activation, so without dropping `second` back out of
        // everActivatedWorktreeIds the prep path would be exercised by sample 0
        // alone and every later sample would measure a cheaper switch.
        const everActivated = new Set(store.getState().everActivatedWorktreeIds)
        everActivated.delete(secondId)
        store.setState({ everActivatedWorktreeIds: everActivated })

        const before = visibleState()
        const firstClickStart = performance.now()
        surface(secondId).click()
        const afterFirstClick = {
          clickDurationMs: performance.now() - firstClickStart,
          ...visibleState()
        }

        const timerStart = performance.now()
        const afterSecondClick = await new Promise<
          ReturnType<typeof visibleState> & {
            clickDurationMs: number
            timerDriftMs: number
          }
        >((resolve) => {
          window.setTimeout(() => {
            const firedAt = performance.now()
            const secondClickStart = performance.now()
            surface(firstId).click()
            resolve({
              clickDurationMs: performance.now() - secondClickStart,
              timerDriftMs: firedAt - timerStart - timerDelayMs,
              ...visibleState()
            })
          }, timerDelayMs)
        })

        await new Promise((resolve) => window.setTimeout(resolve, quietWindowMs))
        const afterQuietWindow = visibleState()

        samples.push({ before, afterFirstClick, afterSecondClick, afterQuietWindow })
      }

      return samples
    },
    {
      firstId: firstWorktreeId,
      secondId: secondWorktreeId,
      timerDelayMs: CLICK_BACK_TIMER_DELAY_MS,
      quietWindowMs: SELECTION_QUIET_WINDOW_MS,
      sampleCount: SWITCH_SAMPLES
    }
  )
}

test.describe('Worktree switch responsiveness', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('updates the selected workspace in the same click task when changing back', async ({
    orcaPage
  }, testInfo) => {
    const [firstWorktreeId, secondWorktreeId] = await prepareSidebarForSwitchTest(orcaPage)
    const firstRow = worktreeRow(orcaPage, firstWorktreeId)
    const secondRow = worktreeRow(orcaPage, secondWorktreeId)

    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()
    await expect(firstRow).toHaveAttribute('aria-current', 'page')
    await expect(orcaPage.locator('[data-rendered-active-worktree-id]')).toHaveAttribute(
      'data-rendered-active-worktree-id',
      firstWorktreeId
    )

    const samples = await measureSwitchSamples(orcaPage, firstWorktreeId, secondWorktreeId)

    const timerDriftMs = samples.map((sample) => sample.afterSecondClick.timerDriftMs)
    const switchClickDurationMs = samples.map((sample) => sample.afterFirstClick.clickDurationMs)
    const backClickDurationMs = samples.map((sample) => sample.afterSecondClick.clickDurationMs)
    const distribution = {
      samples: SWITCH_SAMPLES,
      timerDriftMs: timerDriftMs.map(round),
      secondWorstTimerDriftMs: round(secondWorst(timerDriftMs)),
      switchClickDurationMs: switchClickDurationMs.map(round),
      secondWorstSwitchClickDurationMs: round(secondWorst(switchClickDurationMs)),
      backClickDurationMs: backClickDurationMs.map(round),
      secondWorstBackClickDurationMs: round(secondWorst(backClickDurationMs))
    }
    // Why: all four ORCA-214/222 instances were unreadable until someone re-ran
    // by hand, because the value was never recorded on green. The `list`
    // reporter prints test stdout, so this line makes the distribution free.
    console.log(`[worktree-switch-responsiveness] ${JSON.stringify(distribution)}`)
    testInfo.annotations.push({
      type: 'worktree-switch-responsiveness',
      description: JSON.stringify(distribution)
    })

    for (const [index, sample] of samples.entries()) {
      expect(sample.before, `sample ${index} before`).toMatchObject({
        firstCurrent: 'page',
        secondCurrent: null,
        renderedWorktreeId: firstWorktreeId
      })
      expect(sample.afterFirstClick, `sample ${index} afterFirstClick`).toMatchObject({
        firstCurrent: null,
        secondCurrent: 'page',
        renderedWorktreeId: firstWorktreeId
      })
      expect(sample.afterSecondClick, `sample ${index} afterSecondClick`).toMatchObject({
        firstCurrent: 'page',
        secondCurrent: null
      })
      // Why: sidebar selection commits synchronously; the terminal surface may
      // still finish the prior switch until the quiet-window check below.
      expect(sample.afterQuietWindow, `sample ${index} afterQuietWindow`).toMatchObject({
        firstCurrent: 'page',
        secondCurrent: null,
        renderedWorktreeId: firstWorktreeId
      })
    }

    expect(secondWorst(switchClickDurationMs)).toBeLessThanOrEqual(MAX_CLICK_TASK_DURATION_MS)
    expect(secondWorst(backClickDurationMs)).toBeLessThanOrEqual(MAX_CLICK_TASK_DURATION_MS)
    expect(secondWorst(timerDriftMs)).toBeLessThanOrEqual(MAX_CLICK_BACK_TIMER_DRIFT_MS)

    expect(Math.max(...switchClickDurationMs)).toBeLessThanOrEqual(
      MAX_SAMPLE_CLICK_TASK_DURATION_MS
    )
    expect(Math.max(...backClickDurationMs)).toBeLessThanOrEqual(MAX_SAMPLE_CLICK_TASK_DURATION_MS)
    expect(Math.max(...timerDriftMs)).toBeLessThanOrEqual(MAX_SAMPLE_TIMER_DRIFT_MS)
  })
})
