import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { toWebTerminalSurfaceTabId } from '../../../src/shared/terminal-surface-id'
import { expect } from './orca-app'
import { createRemoteSessionBulkOpenFixture } from './remote-session-bulk-open-fixture'
import {
  formatBusyRun,
  startRendererTaskTrace,
  stopRendererTaskTrace,
  worstBusyRun,
  type RendererBusyRun
} from './renderer-task-trace'
import { closeStreamingTerminals } from './streaming-terminal-cleanup'
import { waitForActivePanePtyId } from './terminal'

/** Multi-worktree load: several agent-like streaming terminals per worktree. */
export const BULK_OPEN_WORKTREE_COUNT = 3
export const BULK_OPEN_TABS_PER_WORKTREE = 4
/** Agent backlog the remotes build up while the terminal view is away. */
const FLOOD_ACCUMULATION_MS = 4_000
export const HIDDEN_FLOOD_WINDOW_MS = 2_000
const STORM_SETTLE_MS = 3_000
/**
 * Soft/hard freeze against the longest unserviced stretch.
 *
 * No longer this oracle's verdict (ORCA-230) — see the task ceilings below.
 * Kept because ssh-docker-bulk-open-freeze-repro.spec.ts asserts on them over
 * its own topology, which has no measurements here and must not inherit a
 * ceiling derived from this one.
 *
 * The derivation ORCA-199 left here is withdrawn: the 1017.7 / 1017.8ms it
 * called "real product behaviour" was the harness. With the paired client's
 * window never shown, two tasks per storm run ~1017ms on a single ~1004ms
 * compositor `Commit`; showing the window removes them. Nothing below may be
 * re-derived from those numbers.
 */
export const SOFT_FREEZE_LAG_MS = 2_000
export const HARD_FREEZE_LAG_MS = 5_000
/**
 * Soft freeze signal — one task the UI cannot interrupt, which is what a user
 * feels. Derived, not chosen: 2.5x the worst of five measured CI runs against a
 * composited window, rounded up to the next 50ms (2.5 x 235.1 = 587.8 -> 600).
 *
 * The six: 196.3 / 216.9 / 232.1 (runs 31954263506, 31954280563, 31954298734),
 * 171.0 / 235.1 (runs 31951413594, 31952659728, shown arm of the shape
 * diagnostic over the identical storm) and 166.6 (run 31956652960, the first
 * under these ceilings). Range 166.6-235.1, a 1.4x spread.
 *
 * n=6 is not a distribution, and the margin is sized for that rather than for
 * confidence in the number. Read the cost before treating 600 as tight: it sits
 * 2.6x above the worst measured task, so a regression has to more than double
 * the longest task to trip it. That is the price of five samples, not a claim
 * about where the product's budget is. The value is recorded on green so CI
 * builds the real distribution and this can be tightened against it.
 * See docs/reference/timing-budget-assertions.md.
 */
export const SOFT_FREEZE_TASK_MS = 600
/** Hard freeze — "screen fully frozen". 2.5x the soft ceiling, the ratio it had before. */
export const HARD_FREEZE_TASK_MS = 1_500
/**
 * Hang detector on the busy run, deliberately loose: that number is throughput
 * (870-1322 tasks back to back), not a stall, and the two do not move together
 * — the run that measured the longest busy run of the five, 1725.7ms, also
 * measured the second *lowest* longest task. 2.5x that worst, rounded up.
 */
export const CATASTROPHIC_BUSY_RUN_MS = 4_500

export type BulkOpenSession = {
  marker: string
  tabId: string
  terminal: string
  worktreeId: string
}

export type BulkOpenFreezeReport = {
  /**
   * Longest stretch the main thread never went idle. Keeps the name a gap
   * sampler gave it because it is the same quantity, so readings stay
   * comparable across the instrument change.
   */
  bulkOpenMaxLagMs: number
  /**
   * Longest single task in that stretch — what a gap cannot say. A freeze is
   * one task the UI cannot interrupt; a saturated queue of short ones is a
   * different fault with a different fix, and the two read alike as a gap
   * (ORCA-230). Recorded now, asserted on once CI has a distribution of it.
   */
  bulkOpenMaxTaskMs: number
  hiddenFloodMaxLagMs: number
  hiddenFloodMaxTaskMs: number
  interactionProbeMs: number
  hardFreeze: boolean
  softFreeze: boolean
  sessionCount: number
  worktreeCount: number
  topology: 'paired-remote-server' | 'docker-ssh'
  versionHint: string
  /**
   * Full measurement windows behind the scalars above: where the worst stretch
   * landed, how many tasks filled it, and how much of it the longest one took.
   * Without the task count a `0` cannot be told from an instrument that never
   * ran, and without the fraction a stall cannot be told from a storm.
   */
  probeWindows: {
    bulkOpen: RendererBusyRun
    hiddenFlood: RendererBusyRun
  }
  notes: string[]
}

async function callRuntime<TResult>(page: Page, method: string, params: unknown): Promise<TResult> {
  return page.evaluate(
    async ({ method, params }) => {
      const response = await window.api.runtime.call({ method, params })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    { method, params }
  ) as Promise<TResult>
}

/**
 * How long the renderer takes to service one queued task.
 *
 * Why not requestAnimationFrame: the E2E window is never shown, so Chromium
 * produces no compositor frames for it and rAF fires at ~1Hz or not at all.
 * A double-rAF probe then reports ~2000ms of "freeze" on a perfectly
 * responsive renderer — measured at 1914ms and 2012ms against this spec's
 * 2000ms threshold, which is what made it flake. MessagePort tasks carry no
 * frame or timer-throttling dependency, so this measures the main thread.
 */
export async function measureRendererInteractionMs(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const started = performance.now()
    if (!window.__store) {
      throw new Error('store unavailable for interaction probe')
    }
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(0)
    })
    return performance.now() - started
  })
}

export async function seedBulkOpenRemoteSessions(
  page: Page,
  seed: { repoId: string }
): Promise<{ sessions: BulkOpenSession[]; dispose: () => Promise<void> }> {
  const fixture = createRemoteSessionBulkOpenFixture()
  const sessions: BulkOpenSession[] = []
  const closeSessions = async (): Promise<void> => {
    try {
      await closeStreamingTerminals(
        sessions.map((session) => session.terminal),
        (method, terminal) => callRuntime(page, method, { terminal })
      )
    } finally {
      fixture.dispose()
    }
  }
  try {
    for (let w = 0; w < BULK_OPEN_WORKTREE_COUNT; w += 1) {
      const marker = `BULK_WT_${w}_T0`
      const created = await callRuntime<{
        startupTerminal?: { handle?: string; tabId?: string }
        worktree: { id: string }
      }>(page, 'worktree.create', {
        repo: seed.repoId,
        name: `bulk-open-wt-${w}-${Date.now()}`,
        setupDecision: 'skip',
        activate: false,
        noParent: true,
        startupCommand: fixture.command(marker)
      })
      if (!created.startupTerminal?.handle || !created.startupTerminal.tabId) {
        throw new Error(`Bulk-open worktree ${w} missing startup terminal`)
      }
      const worktreeId = created.worktree.id
      sessions.push({
        marker,
        tabId: toWebTerminalSurfaceTabId(created.startupTerminal.tabId),
        terminal: created.startupTerminal.handle,
        worktreeId
      })

      for (let t = 1; t < BULK_OPEN_TABS_PER_WORKTREE; t += 1) {
        const tabMarker = `BULK_WT_${w}_T${t}`
        const result = await callRuntime<{
          tab: { parentTabId: string; terminal: string | null }
        }>(page, 'session.tabs.createTerminal', {
          worktree: `id:${worktreeId}`,
          command: fixture.command(tabMarker),
          activate: false,
          select: false,
          navigation: 'caller'
        })
        if (!result.tab.terminal) {
          throw new Error(`Bulk-open terminal ${tabMarker} was not created`)
        }
        sessions.push({
          marker: tabMarker,
          tabId: toWebTerminalSurfaceTabId(result.tab.parentTabId),
          terminal: result.tab.terminal,
          worktreeId
        })
      }
    }

    // Ensure fixtures started and are streaming on the host.
    await expect
      .poll(
        async () => {
          const ready = await Promise.all(
            sessions.map(async (session) => {
              const result = await callRuntime<{ terminal: { tail: string[] } }>(
                page,
                'terminal.read',
                { terminal: session.terminal, limit: 200 }
              )
              const text = result.terminal.tail.join('\n')
              return text.includes(`BG:${session.marker}:`)
            })
          )
          return ready.every(Boolean)
        },
        { timeout: 60_000 }
      )
      .toBe(true)

    return {
      sessions,
      dispose: closeSessions
    }
  } catch (error) {
    await closeSessions().catch((cleanupError) => {
      throw new AggregateError(
        [error, cleanupError],
        'Bulk-open session seeding and cleanup failed'
      )
    })
    throw error
  }
}

/** Leave the terminal view so panes park, then let the remote flood accumulate. */
export async function settleBeforeBulkOpen(page: Page): Promise<void> {
  await page.evaluate(() => window.__store?.getState().setActiveView('tasks'))
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  await page.waitForTimeout(FLOOD_ACCUMULATION_MS)
}

/**
 * The burst itself. Shared so the shape diagnostic
 * (remote-session-bulk-open-block-shape.spec.ts) drives the identical storm
 * rather than a lookalike.
 */
export async function runBulkOpenStorm(page: Page, sessions: BulkOpenSession[]): Promise<number> {
  const worktreeIds = [...new Set(sessions.map((session) => session.worktreeId))]
  const openStarted = Date.now()
  for (const worktreeId of worktreeIds) {
    const tabs = sessions.filter((session) => session.worktreeId === worktreeId)
    for (const tab of tabs) {
      await page.evaluate(
        ({ targetWorktreeId, tabId }) => {
          const state = window.__store?.getState()
          state?.setActiveView('terminal')
          state?.setActiveWorktree(targetWorktreeId)
          state?.setActiveTabForWorktree(targetWorktreeId, tabId)
        },
        { targetWorktreeId: worktreeId, tabId: tab.tabId }
      )
    }
  }
  // One more full pass clicking visible tabs if present.
  for (const session of sessions) {
    const locator = page.locator(`[data-testid="sortable-tab"][data-tab-id="${session.tabId}"]`)
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 2_000 }).catch(() => undefined)
    }
  }
  // Let the storm settle enough to measure residual lag.
  await page.waitForTimeout(STORM_SETTLE_MS)
  return Date.now() - openStarted
}

/**
 * Repro R1 core: leave remotes streaming hidden, then burst-open sessions
 * (reopening remote sessions after agents have been writing in the background).
 */
export async function runBulkOpenFreezeOracle(
  page: Page,
  sessions: BulkOpenSession[],
  opts: {
    topology: BulkOpenFreezeReport['topology']
    versionHint?: string
    reportDir?: string
  }
): Promise<BulkOpenFreezeReport> {
  const notes: string[] = []
  const worktreeIds = [...new Set(sessions.map((s) => s.worktreeId))]

  await settleBeforeBulkOpen(page)

  // Same instrument, same page, no bulk open inside it: the control for the
  // measured window below, and the only thing that makes a large bulk-open
  // reading attributable to the bulk open.
  const hiddenTrace = await startRendererTaskTrace(page)
  await page.waitForTimeout(HIDDEN_FLOOD_WINDOW_MS)
  const hiddenFlood = worstBusyRun(await stopRendererTaskTrace(hiddenTrace))
  const hiddenFloodMaxLagMs = hiddenFlood.busyRunMs
  notes.push(formatBusyRun(hiddenFlood, 'hidden streaming'))

  // Burst open remote sessions (worktree + tab activate).
  const openTrace = await startRendererTaskTrace(page)
  const openWallMs = await runBulkOpenStorm(page, sessions)
  const bulkOpen = worstBusyRun(await stopRendererTaskTrace(openTrace))
  const bulkOpenMaxLagMs = bulkOpen.busyRunMs
  notes.push(`bulk open wall=${openWallMs}ms`)
  notes.push(formatBusyRun(bulkOpen, 'bulk open'))
  if (bulkOpen.taskCount === 0) {
    throw new Error('bulk open window traced no tasks — the window measured nothing')
  }

  // Confirm last session is live after the storm (host PTYs survived).
  const last = sessions.at(-1)
  if (!last) {
    throw new Error('bulk-open freeze oracle requires at least one session')
  }
  await page.evaluate(
    ({ targetWorktreeId, tabId }) => {
      const state = window.__store?.getState()
      state?.setActiveView('terminal')
      state?.setActiveWorktree(targetWorktreeId)
      state?.setActiveTabForWorktree(targetWorktreeId, tabId)
    },
    { targetWorktreeId: last.worktreeId, tabId: last.tabId }
  )
  await waitForActivePanePtyId(page, 30_000).catch(() => {
    notes.push('active pane PTY id not ready after bulk open (possible re-attach failure)')
  })

  const interactionProbeMs = await measureRendererInteractionMs(page)
  notes.push(`post-storm renderer interaction=${interactionProbeMs.toFixed(0)}ms`)

  const report: BulkOpenFreezeReport = {
    bulkOpenMaxLagMs,
    bulkOpenMaxTaskMs: bulkOpen.maxTaskMs,
    hiddenFloodMaxLagMs,
    hiddenFloodMaxTaskMs: hiddenFlood.maxTaskMs,
    interactionProbeMs,
    hardFreeze:
      bulkOpen.maxTaskMs >= HARD_FREEZE_TASK_MS ||
      interactionProbeMs >= HARD_FREEZE_TASK_MS ||
      bulkOpenMaxLagMs >= CATASTROPHIC_BUSY_RUN_MS,
    softFreeze:
      bulkOpen.maxTaskMs >= SOFT_FREEZE_TASK_MS || interactionProbeMs >= SOFT_FREEZE_TASK_MS,
    sessionCount: sessions.length,
    worktreeCount: worktreeIds.length,
    topology: opts.topology,
    versionHint: opts.versionHint ?? process.env.ORCA_VERSION ?? 'unknown',
    probeWindows: { bulkOpen, hiddenFlood },
    notes
  }

  if (opts.reportDir) {
    mkdirSync(opts.reportDir, { recursive: true })
    const outPath = path.join(opts.reportDir, `bulk-open-freeze-${opts.topology}.json`)
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
    notes.push(`wrote ${outPath}`)
  }

  return report
}
