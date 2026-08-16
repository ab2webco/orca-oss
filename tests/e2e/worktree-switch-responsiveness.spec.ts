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
// Why (ORCA-225): same class, for the block sampler below — a hang detector,
// not a budget. That number has no derived ceiling yet; see the sampler's note.
const MAX_SAMPLE_SWITCH_WINDOW_BLOCK_MS = 500

const CLICK_BACK_TIMER_DELAY_MS = 120
const SELECTION_QUIET_WINDOW_MS = 700
const PTY_TEARDOWN_TIMEOUT_MS = 15_000
const PTY_TEARDOWN_SETTLE_MS = 200

type VisibleState = {
  firstCurrent: string | null
  secondCurrent: string | null
  renderedWorktreeId: string | null
}

type BlockWindow = {
  maxBlockMs: number
  maxBlockAtMs: number
}

type SwitchSample = {
  before: VisibleState
  fixture: { tabCount: number; livePtyCount: number; generations: number[] }
  afterFirstClick: VisibleState & { clickDurationMs: number; generations: number[] }
  afterSecondClick: VisibleState & { clickDurationMs: number; timerDriftMs: number }
  afterQuietWindow: VisibleState & { generations: number[] }
  idleWindow: BlockWindow
  switchWindow: BlockWindow
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
    async ({
      firstId,
      secondId,
      timerDelayMs,
      quietWindowMs,
      sampleCount,
      ptyTeardownMs,
      ptySettleMs
    }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }

      const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))
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

      const secondTabs = () => store.getState().tabsByWorktree[secondId] ?? []
      const generations = (): number[] => secondTabs().map((tab) => tab.generation ?? 0)
      const livePtyIds = (): string[] => {
        const ptyIdsByTabId = store.getState().ptyIdsByTabId
        return secondTabs().flatMap((tab) => ptyIdsByTabId[tab.id] ?? [])
      }

      // Why (ORCA-225): setActiveWorktree bumps tab generation — the remount
      // half of activation's terminal prep — only when every tab of the target
      // worktree is dead (`allDead`, store/slices/worktrees.ts). The fixture
      // used to keep one live PTY, so that branch never ran and no mutation of
      // it could move anything this spec measures. Kill the PTYs for real
      // rather than editing ptyIdsByTabId: it is the state a user reaches by
      // exiting their shells and switching back, and a faked map would not
      // respawn the way the real one does.
      const killSecondWorktreePtys = async (): Promise<void> => {
        const deadline = performance.now() + ptyTeardownMs
        while (performance.now() < deadline) {
          const ptyIds = livePtyIds()
          if (ptyIds.length === 0) {
            return
          }
          for (const ptyId of ptyIds) {
            await window.api.pty.kill(ptyId).catch(() => {})
          }
          await sleep(50)
        }
        throw new Error('Worktree switch responsiveness fixture could not kill the target PTYs')
      }

      // Why (ORCA-225): neither budget above observes the switch. clickDuration
      // times the synchronous handler, which only writes the optimistic sidebar
      // selection — activation awaits an IPC round trip first
      // (lib/sidebar-worktree-activation.ts) and commits in a later task.
      // timerDrift samples the main thread once, at the far edge of the window,
      // so it only sees a block straddling that instant: a deliberate 60ms
      // freeze injected into setActiveWorktree read timerDriftMs 1.4. Ticking a
      // MessageChannel and keeping the longest gap between turns sees every task
      // the switch runs, wherever it lands. Calibrated locally: 0.1-0.6ms over
      // an idle window, and 10.0/20.0/40.1/60.2ms for injected 10/20/40/60ms
      // blocks. The idle window is recorded beside it so a large reading can
      // never be blamed on the instrument without evidence.
      // See docs/reference/timing-budget-assertions.md.
      const startMainThreadBlockSampler = (): { stop: () => BlockWindow } => {
        const channel = new MessageChannel()
        const startedAt = performance.now()
        let lastTickAt = startedAt
        let maxBlockMs = 0
        let maxBlockAtMs = 0
        let running = true
        channel.port1.onmessage = (): void => {
          const now = performance.now()
          const gapMs = now - lastTickAt
          if (gapMs > maxBlockMs) {
            maxBlockMs = gapMs
            maxBlockAtMs = lastTickAt - startedAt
          }
          lastTickAt = now
          if (running) {
            channel.port2.postMessage(0)
          }
        }
        channel.port2.postMessage(0)
        return {
          stop: () => {
            running = false
            channel.port1.close()
            channel.port2.close()
            return { maxBlockMs, maxBlockAtMs }
          }
        }
      }

      type BlockWindow = { maxBlockMs: number; maxBlockAtMs: number }

      const samples: {
        before: ReturnType<typeof visibleState>
        fixture: { tabCount: number; livePtyCount: number; generations: number[] }
        afterFirstClick: ReturnType<typeof visibleState> & {
          clickDurationMs: number
          generations: number[]
        }
        afterSecondClick: ReturnType<typeof visibleState> & {
          clickDurationMs: number
          timerDriftMs: number
        }
        afterQuietWindow: ReturnType<typeof visibleState> & { generations: number[] }
        idleWindow: BlockWindow
        switchWindow: BlockWindow
      }[] = []

      for (let sample = 0; sample < sampleCount; sample += 1) {
        // Why: setActiveWorktree only arms the deferred terminal prep on a
        // worktree's first activation, so without dropping `second` back out of
        // everActivatedWorktreeIds the prep path would be exercised by sample 0
        // alone and every later sample would measure a cheaper switch.
        const everActivated = new Set(store.getState().everActivatedWorktreeIds)
        everActivated.delete(secondId)
        store.setState({ everActivatedWorktreeIds: everActivated })

        // The activation being measured respawns the tab it remounts, so the
        // dead-PTY fixture has to be re-armed for every sample.
        await killSecondWorktreePtys()
        await sleep(ptySettleMs)

        // Control for the sampler: same instrument, same window length, no
        // switch inside it.
        const idleSampler = startMainThreadBlockSampler()
        await sleep(timerDelayMs)
        const idleWindow = idleSampler.stop()

        const fixture = {
          tabCount: secondTabs().length,
          livePtyCount: livePtyIds().length,
          generations: generations()
        }

        const switchSampler = startMainThreadBlockSampler()
        const before = visibleState()
        const firstClickStart = performance.now()
        surface(secondId).click()
        const afterFirstClick = {
          clickDurationMs: performance.now() - firstClickStart,
          generations: generations(),
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
        const switchWindow = switchSampler.stop()

        await sleep(quietWindowMs)
        const afterQuietWindow = { ...visibleState(), generations: generations() }

        samples.push({
          before,
          fixture,
          afterFirstClick,
          afterSecondClick,
          afterQuietWindow,
          idleWindow,
          switchWindow
        })
      }

      return samples
    },
    {
      firstId: firstWorktreeId,
      secondId: secondWorktreeId,
      timerDelayMs: CLICK_BACK_TIMER_DELAY_MS,
      quietWindowMs: SELECTION_QUIET_WINDOW_MS,
      sampleCount: SWITCH_SAMPLES,
      ptyTeardownMs: PTY_TEARDOWN_TIMEOUT_MS,
      ptySettleMs: PTY_TEARDOWN_SETTLE_MS
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
    const switchWindowMaxBlockMs = samples.map((sample) => sample.switchWindow.maxBlockMs)
    const idleWindowMaxBlockMs = samples.map((sample) => sample.idleWindow.maxBlockMs)
    const distribution = {
      samples: SWITCH_SAMPLES,
      timerDriftMs: timerDriftMs.map(round),
      secondWorstTimerDriftMs: round(secondWorst(timerDriftMs)),
      switchClickDurationMs: switchClickDurationMs.map(round),
      secondWorstSwitchClickDurationMs: round(secondWorst(switchClickDurationMs)),
      backClickDurationMs: backClickDurationMs.map(round),
      secondWorstBackClickDurationMs: round(secondWorst(backClickDurationMs)),
      // Why recorded, not asserted at 32 (ORCA-225): this is the only number
      // here that reflects the switch's real main-thread cost, and the current
      // product spends 33-64ms of it locally — one block starting ~2ms after
      // the click, against an idle control of 0.1-0.6ms. A ceiling has to be
      // derived from CI percentiles once that cost is addressed; inventing one
      // now is the exact failure docs/reference/timing-budget-assertions.md
      // documents. Recording it makes every run's value readable without a
      // re-run, the same reason the rest of this distribution is logged.
      idleWindowMaxBlockMs: idleWindowMaxBlockMs.map(round),
      switchWindowMaxBlockMs: switchWindowMaxBlockMs.map(round),
      switchWindowMaxBlockAtMs: samples.map((sample) => round(sample.switchWindow.maxBlockAtMs)),
      secondWorstSwitchWindowBlockMs: round(secondWorst(switchWindowMaxBlockMs))
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
      // Why (ORCA-225): a sample only exercises activation's expensive branch
      // while the fixture holds. One surviving live PTY degrades the switch to a
      // cheap store write and the run goes green without having measured it —
      // so assert the fixture, not only the timings.
      expect(sample.fixture.tabCount, `sample ${index} fixture tabCount`).toBeGreaterThan(0)
      expect(sample.fixture.livePtyCount, `sample ${index} fixture livePtyCount`).toBe(0)
      // The allDead branch bumps every tab's generation. No bump means the
      // remount half of the prep never ran and the sample proves nothing.
      expect(sample.afterQuietWindow.generations, `sample ${index} generations`).toEqual(
        sample.fixture.generations.map((generation) => generation + 1)
      )

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
      // Why (ORCA-225): the selection commits in the click task, the terminal
      // prep must not. With the dead-PTY fixture the prep's expensive half is
      // the generation bump, so an unchanged generation here is the direct
      // statement that activation stayed off the click task — and it goes red
      // the moment activation is made synchronous, which no timing budget in
      // this file can see (the click handler itself is ~0.3ms either way).
      expect(sample.afterFirstClick.generations, `sample ${index} prep in click task`).toEqual(
        sample.fixture.generations
      )
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
    expect(Math.max(...switchWindowMaxBlockMs)).toBeLessThanOrEqual(
      MAX_SAMPLE_SWITCH_WINDOW_BLOCK_MS
    )
  })

  test('@headful mounts the incoming terminal before revealing its worktree', async ({
    orcaPage
  }, testInfo) => {
    const [firstWorktreeId, secondWorktreeId] = await prepareSidebarForSwitchTest(orcaPage)
    await expect(orcaPage.locator('.xterm-screen').filter({ visible: true })).toHaveCount(1)

    const targetPtyIds = await orcaPage.evaluate((worktreeId) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('window.__store is not available')
      }
      return (state.tabsByWorktree[worktreeId] ?? []).flatMap(
        (tab) => state.ptyIdsByTabId[tab.id] ?? []
      )
    }, secondWorktreeId)
    for (const ptyId of targetPtyIds) {
      await orcaPage.evaluate((id) => window.api.pty.kill(id), ptyId)
    }
    await orcaPage.evaluate((worktreeId) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const everActivatedWorktreeIds = new Set(store.getState().everActivatedWorktreeIds)
      everActivatedWorktreeIds.delete(worktreeId)
      store.setState({ everActivatedWorktreeIds })
    }, secondWorktreeId)

    const result = await orcaPage.evaluate(
      async ({ firstId, secondId }) => {
        type FrameSample = {
          atMs: number
          xterms: number
          xtermsLoose: number
          screens: number
          xtermsTotal: number
          containersTotal: number
          rendered: string | null
        }
        const root = document.querySelector<HTMLElement>('[data-rendered-active-worktree-id]')
        const targetSurface = [...document.querySelectorAll<HTMLElement>('[data-worktree-id]')]
          .find((candidate) => candidate.dataset.worktreeId === secondId)
          ?.querySelector<HTMLElement>('[data-worktree-card-surface]')
        if (!root || !targetSurface) {
          throw new Error('Missing rendered worktree root or target surface')
        }
        // Why the explicit options: bare checkVisibility() only rejects display:none —
        // visibilityProperty / opacityProperty / contentVisibilityAuto all default false. The
        // pre-mounted incoming worktree is `visibility:hidden`, so the bare call would count its
        // panes as painted and the probe would report a healthy switch without looking at one.
        const visibleCount = (selector: string): number =>
          [...document.querySelectorAll<HTMLElement>(selector)].filter((element) =>
            element.checkVisibility({
              visibilityProperty: true,
              opacityProperty: true,
              contentVisibilityAuto: true
            })
          ).length
        // Recorded beside it so the claim above is evidence in the run, not an assertion here.
        const looseVisibleCount = (selector: string): number =>
          [...document.querySelectorAll<HTMLElement>(selector)].filter((element) =>
            element.checkVisibility()
          ).length
        const frames: FrameSample[] = []
        let sampling = true
        const sample = (atMs: number): void => {
          frames.push({
            atMs,
            xterms: visibleCount('.xterm'),
            xtermsLoose: looseVisibleCount('.xterm'),
            screens: visibleCount('.xterm-screen'),
            xtermsTotal: document.querySelectorAll('.xterm').length,
            containersTotal: document.querySelectorAll('[data-terminal-tab-id]').length,
            rendered: root.getAttribute('data-rendered-active-worktree-id')
          })
          if (sampling) {
            requestAnimationFrame(sample)
          }
        }
        requestAnimationFrame(sample)
        while (frames.length < 3) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
        }
        // Click late in the sampled frame so a deferred empty commit cannot hide inside a fresh frame budget.
        await new Promise((resolve) => window.setTimeout(resolve, 24))
        const visibleBefore = visibleCount('.xterm-screen')
        const clickAtMs = performance.now()
        let incomingScreensAtReveal = -1
        const reveal = new Promise<number>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            observer.disconnect()
            reject(new Error('Incoming worktree was not revealed'))
          }, 2000)
          const observer = new MutationObserver(() => {
            if (root.getAttribute('data-rendered-active-worktree-id') !== secondId) {
              return
            }
            const incomingSurface = [
              ...document.querySelectorAll<HTMLElement>('[data-terminal-worktree-id]')
            ].find((surface) => surface.dataset.terminalWorktreeId === secondId)
            incomingScreensAtReveal = incomingSurface?.querySelectorAll('.xterm-screen').length ?? 0
            window.clearTimeout(timeoutId)
            observer.disconnect()
            resolve(performance.now() - clickAtMs)
          })
          observer.observe(root, {
            attributes: true,
            attributeFilter: ['data-rendered-active-worktree-id']
          })
        })
        targetSurface.click()
        const revealMs = await reveal
        await new Promise((resolve) => window.setTimeout(resolve, 800))
        sampling = false
        const visibleAfter = visibleCount('.xterm-screen')
        const switchFrames = frames.filter((frame) => frame.atMs >= clickAtMs)
        return {
          firstId,
          secondId,
          revealMs,
          incomingScreensAtReveal,
          visibleBefore,
          visibleAfter,
          framesBeforeClick: frames.filter((frame) => frame.atMs < clickAtMs).length,
          framesTotal: frames.length,
          emptyFrames: switchFrames.filter((frame) => frame.xterms === 0),
          screenlessFrames: switchFrames.filter((frame) => frame.xterms > 0 && frame.screens === 0),
          doublePaintedFrames: switchFrames.filter((frame) => frame.xterms > 1),
          maxLooseXterms: Math.max(...switchFrames.map((frame) => frame.xtermsLoose)),
          frames
        }
      },
      { firstId: firstWorktreeId, secondId: secondWorktreeId }
    )

    console.info(
      '[ORCA-229 frame probe]',
      JSON.stringify({
        revealMs: result.revealMs,
        incomingScreensAtReveal: result.incomingScreensAtReveal,
        framesBeforeClick: result.framesBeforeClick,
        framesTotal: result.framesTotal,
        visibleBefore: result.visibleBefore,
        visibleAfter: result.visibleAfter,
        emptyFrames: result.emptyFrames.length,
        screenlessFrames: result.screenlessFrames.length,
        doublePaintedFrames: result.doublePaintedFrames.length,
        maxLooseXterms: result.maxLooseXterms,
        maxXtermsTotal: Math.max(...result.frames.map((frame) => frame.xtermsTotal)),
        maxContainersTotal: Math.max(...result.frames.map((frame) => frame.containersTotal))
      })
    )
    await testInfo.attach('worktree-switch-frame-probe', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json'
    })
    expect(result.framesBeforeClick).toBeGreaterThan(0)
    expect(result.framesTotal).toBeGreaterThan(20)
    expect(result.visibleBefore).toBe(1)
    expect(result.visibleAfter).toBe(1)
    expect(result.incomingScreensAtReveal).toBeGreaterThan(0)
    expect(result.emptyFrames).toEqual([])
    expect(result.screenlessFrames).toEqual([])
    expect(result.doublePaintedFrames).toEqual([])
    expect(result.revealMs).toBeLessThan(100)
  })
})
