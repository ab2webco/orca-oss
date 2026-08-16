/**
 * ORCA-251 — one xterm write element, measured; now the guard on the split.
 *
 * On demand, not in the suite: it answers a question rather than guarding a
 * regression, and it costs a paired host and a seeded storm.
 *
 * The contradiction it exists to break. `WriteBuffer._innerWrite` checks its
 * 12ms budget only *between* elements, so ORCA-239's 128.4ms `TimerFire` task
 * has to be ONE element. `takeQueuedChunk` caps an element at
 * BACKGROUND_CHUNK_CHARS = 16 KiB. And 16 KiB of the bulk-open fixture's own
 * stream parses in 1.50ms median (n=64, @xterm/headless 6.1.0-beta.287, 80x60,
 * scrollback 5000, macOS). Three readings that cannot all be true at once.
 *
 * Three explanations, separated in one run on one machine. **A**, settled: the
 * element was not 16 KiB, it was 579,767 chars — the snapshot replay wrote it
 * whole, bypassing the scheduler's chunker (`replay-guard.ts`).
 *
 * - A: the element is not 16 KiB in the product. `live` reports maxChars.
 * - B: dead — the DOM Terminal costs 1.6x the DOM-less one (0.8 vs 0.5ms per
 *   16 KiB), not the 77x the contradiction needed. `dom` vs `nodom`, same page,
 *   same run, same bundle: the only pair that can say this.
 * - C: dead — the 400ms control read 400.4ms, and 16 KiB parses FASTER on CI
 *   (0.5ms) than on the Mac (1.5ms). A cross-machine comparison against the
 *   headless number could not have decided this; these two arms can.
 *
 * Per element it records the parse AND the write callback, because they
 * partition the task: a cheap parse alone would only move the question.
 *
 * The chunk sweep (16 KiB vs 4 KiB) is for ORCA-251's point 2 — whether
 * splitting the write splits the task — and it is only readable once the
 * partition above says the burn is inside the parse.
 *
 * What `dom` is not: the product's panes also carry the webgl renderer, the
 * search/links/unicode addons and the scheduler's own callbacks. `dom` is the
 * bare DOM Terminal, so `live` minus `dom` is what Orca adds on top.
 *
 * After ORCA-251's split, the storm's longest task can still be the React
 * commit that mounts panes (229.5ms in run 31972534074) — that is ORCA-239's
 * other regime, not this one. The gate is on the element, which is this ticket's.
 *
 * Run: CI Linux only — the paired web client does not hydrate `window.__store`
 * locally. `gh workflow run "E2E" -R ab2webco/orca-oss --ref <branch>
 * -f ref=<branch> -f project=electron-ondemand
 * -f test_files='["tests/e2e/remote-session-bulk-open-write-cost.spec.ts"]'`
 */
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { launchPairedWebClient, type PairedWebClient } from './helpers/paired-electron-client'
import {
  HIDDEN_FLOOD_WINDOW_MS,
  runBulkOpenStorm,
  seedBulkOpenRemoteSessions,
  settleBeforeBulkOpen
} from './helpers/remote-session-bulk-open-oracle'
import {
  formatBusyRun,
  startRendererTaskTrace,
  stopRendererTaskTrace,
  worstBusyRun,
  type RendererBusyRun
} from './helpers/renderer-task-trace'
import {
  runXtermWriteBench,
  type XtermWriteBenchConfig,
  type XtermWriteBenchResult
} from './helpers/xterm-write-element-bench'
import {
  installXtermWriteCostProbe,
  setXtermWriteCostRecording,
  takeXtermBigWrites,
  takeXtermWriteElements,
  waitForXtermWriteCostProbe
} from './helpers/xterm-write-element-cost'
import {
  formatXtermWriteStats,
  summarizeXtermWriteElements,
  type XtermWriteElementStats
} from './helpers/xterm-write-element-stats'

/** The scheduler's own cap, mirrored so a drift in either shows up as atCap=0. */
const BACKGROUND_CHUNK_CHARS = 16 * 1024
const POSITIVE_CONTROL_MS = 400
const CONTROL_WINDOW_MS = 1_500
/** A control that reads below this measured nothing worth trusting. */
const MIN_CONTROL_FRACTION = 0.8
const PROBE_ARM_TIMEOUT_MS = 120_000
/** Enough elements for a median to mean something without a config running long. */
const BENCH_WRITES = 64
const BENCH_BUDGET_MS = 8_000
const MIN_BENCH_WRITES = 8
const BENCH_QUIET_SETTLE_MS = 2_000
const BENCH_QUIET_WINDOW_MS = 1_000
/** A page still this busy before the bench cannot host a per-element measurement. */
const MAX_QUIET_TASK_MS = 200
/** See the gate below: sized to fail on both pre-fix runs, not to be a budget. */
const MAX_ELEMENT_PARSE_MS = 40
const BENCH_COLS = 80
const BENCH_ROWS = 60
const BENCH_SCROLLBACK_ROWS = 5_000

type SchedulerDebugSnapshot = {
  backgroundWriteCount: number
  deferredForegroundWriteCount: number
  foregroundWriteCount: number
  peakQueuedChars: number
  peakQueuedCharsByTerminal: number
  droppedBacklogCount: number
  drainWrites: number[]
}

type SchedulerDebugWindow = Window & {
  __terminalOutputSchedulerDebug?: {
    reset: () => void
    snapshot: () => SchedulerDebugSnapshot
  }
}

const BENCH_ARMS: { label: string; mode: 'nodom' | 'dom'; chunkChars: number }[] = [
  { label: 'nodom-16k', mode: 'nodom', chunkChars: BACKGROUND_CHUNK_CHARS },
  { label: 'nodom-4k', mode: 'nodom', chunkChars: 4 * 1024 },
  { label: 'dom-16k', mode: 'dom', chunkChars: BACKGROUND_CHUNK_CHARS },
  { label: 'dom-4k', mode: 'dom', chunkChars: 4 * 1024 }
]

const BENCH_CONFIGS: XtermWriteBenchConfig[] = BENCH_ARMS.map((arm) => ({
  ...arm,
  writes: BENCH_WRITES,
  budgetMs: BENCH_BUDGET_MS,
  cols: BENCH_COLS,
  rows: BENCH_ROWS,
  scrollback: BENCH_SCROLLBACK_ROWS
}))

test('R1 bulk-open xterm write element cost @ondemand @freeze-repro', async ({ testRepoPath }) => {
  test.setTimeout(900_000)

  const host = await launchHeadlessPairedRuntimeHost()
  let webClient: PairedWebClient | null = null
  let disposeSessions: (() => Promise<void>) | null = null
  try {
    const added = await host.client.call<{ repo: { id: string } }>('repo.add', {
      path: testRepoPath,
      kind: 'git'
    })
    await expect
      .poll(
        async () => {
          const listed = await host.client.call<{ totalCount: number }>('worktree.list', {
            repo: `id:${added.result.repo.id}`
          })
          return listed.result.totalCount
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0)

    // Shown: ORCA-230 established that a never-shown window measures its own
    // compositor wait, not the product.
    webClient = await launchPairedWebClient(host.app, host.offer, {
      terminalParkingDelayMs: 500,
      showWindow: true
    })
    const page = webClient.page
    await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 60_000 })
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().allWorktrees().length ?? 0), {
        timeout: 90_000
      })
      .toBeGreaterThan(0)

    // Installed before the storm mounts the panes it measures; awaited after,
    // because the storm is what makes the first terminal exist.
    await installXtermWriteCostProbe(page, { bigWriteChars: BACKGROUND_CHUNK_CHARS + 1 })

    const seeded = await seedBulkOpenRemoteSessions(page, { repoId: added.result.repo.id })
    disposeSessions = seeded.dispose

    await settleBeforeBulkOpen(page)

    // Runner scalar. Without it a large `nodom` reading cannot be told from a
    // slow machine, which is explanation C.
    const controlTrace = await startRendererTaskTrace(page)
    await page.evaluate((blockMs) => {
      function orcaWriteCostPositiveControl(): number {
        let acc = 0
        const until = performance.now() + blockMs
        while (performance.now() < until) {
          for (let i = 0; i < 5_000; i += 1) {
            acc += Math.sqrt(i)
          }
        }
        return acc
      }
      return orcaWriteCostPositiveControl()
    }, POSITIVE_CONTROL_MS)
    await page.waitForTimeout(CONTROL_WINDOW_MS)
    const control = worstBusyRun(await stopRendererTaskTrace(controlTrace))

    await resetSchedulerDebug(page)
    await takeXtermWriteElements(page)
    await setXtermWriteCostRecording(page, true)

    // Negative control: the same probe over hidden streaming with no bulk open
    // inside it. Elements here are the parked-pane regime, not the burst.
    const hiddenTrace = await startRendererTaskTrace(page)
    await page.waitForTimeout(HIDDEN_FLOOD_WINDOW_MS)
    const hidden = worstBusyRun(await stopRendererTaskTrace(hiddenTrace))
    const hiddenElements = await takeXtermWriteElements(page)

    const stormTrace = await startRendererTaskTrace(page)
    const stormWallMs = await runBulkOpenStorm(page, seeded.sessions)
    const storm = worstBusyRun(await stopRendererTaskTrace(stormTrace))
    const stormElements = await takeXtermWriteElements(page)
    const bigWrites = await takeXtermBigWrites(page)
    await setXtermWriteCostRecording(page, false)
    const scheduler = await readSchedulerDebug(page)
    const armed = await waitForXtermWriteCostProbe(page, PROBE_ARM_TIMEOUT_MS)

    // The fixtures never stop on their own. Leaving them streaming would make
    // the bench arms share the main thread with the very load they explain, so
    // the sessions go first and the quiet window reports what is left.
    await disposeSessions()
    disposeSessions = null
    await page.waitForTimeout(BENCH_QUIET_SETTLE_MS)
    const quietTrace = await startRendererTaskTrace(page)
    await page.waitForTimeout(BENCH_QUIET_WINDOW_MS)
    const quiet = worstBusyRun(await stopRendererTaskTrace(quietTrace))

    // B and C, after the storm so the bench does not compete with it.
    const benches: { result: XtermWriteBenchResult; busy: RendererBusyRun }[] = []
    let benchStats: XtermWriteElementStats[] = []
    for (const config of BENCH_CONFIGS) {
      const trace = await startRendererTaskTrace(page)
      const result = await runXtermWriteBench(page, config)
      const busy = worstBusyRun(await stopRendererTaskTrace(trace))
      benchStats = benchStats.concat(
        summarizeXtermWriteElements(await takeXtermWriteElements(page), config.chunkChars)
      )
      benches.push({ result, busy })
      if (result.truncated) {
        console.log(
          '[write-cost]',
          `${config.label} cut by the ${BENCH_BUDGET_MS}ms budget at ` +
            `${result.writesRun}/${result.writesRequested} writes`
        )
      }
    }

    const stormStats = summarizeXtermWriteElements(stormElements, BACKGROUND_CHUNK_CHARS)
    const hiddenStats = summarizeXtermWriteElements(hiddenElements, BACKGROUND_CHUNK_CHARS)

    console.log('[write-cost]', formatBusyRun(control, 'positive control'))
    console.log('[write-cost]', formatBusyRun(hidden, 'hidden streaming'))
    console.log('[write-cost]', formatBusyRun(storm, 'bulk open'))
    console.log('[write-cost]', formatBusyRun(quiet, 'quiet before bench'))
    for (const stats of hiddenStats) {
      console.log('[write-cost]', `hidden ${formatXtermWriteStats(stats)}`)
    }
    for (const stats of stormStats) {
      console.log('[write-cost]', `storm ${formatXtermWriteStats(stats)}`)
    }
    for (const [index, big] of bigWrites.entries()) {
      console.log(
        '[write-cost]',
        `big write #${index} chars=${big.chars} at=+${big.atMs.toFixed(0)}ms\n${big.stack}`
      )
    }
    for (const entry of benches) {
      console.log(
        '[write-cost]',
        `${entry.result.label} writes=${entry.result.writesRun}/${entry.result.writesRequested} ` +
          `wall=${entry.result.wallMs.toFixed(0)}ms ${formatBusyRun(entry.busy, 'bench')}`
      )
    }
    for (const stats of benchStats) {
      console.log('[write-cost]', `bench ${formatXtermWriteStats(stats)}`)
    }
    console.log(
      '[write-cost]',
      JSON.stringify(
        {
          armed,
          stormWallMs,
          control,
          hidden,
          storm,
          quiet,
          scheduler,
          hiddenStats,
          stormStats,
          bigWrites,
          benches,
          benchStats
        },
        null,
        2
      )
    )

    // Validity. A reading from an instrument that measured nothing is worse
    // than no reading.
    expect(control.maxTaskMs).toBeGreaterThanOrEqual(POSITIVE_CONTROL_MS * MIN_CONTROL_FRACTION)
    expect(storm.taskCount).toBeGreaterThan(0)
    const live = stormStats.find((stats) => stats.tag === 'live')
    expect(live?.count ?? 0).toBeGreaterThan(0)
    expect(quiet.maxTaskMs).toBeLessThan(MAX_QUIET_TASK_MS)
    for (const entry of benches) {
      expect(entry.result.writesRun).toBeGreaterThanOrEqual(MIN_BENCH_WRITES)
    }

    // The fix, in the two quantities that carried it.
    //
    // Before (runs 31971270025 and 31972534074, this same spec against the
    // unsplit replay): maxChars 579,767 — 35x the cap — with 5 oversized writes
    // in one storm, and a single element parsing for 102 and 114.3ms. Those two
    // runs are the mutation arm: the product then handed the snapshot to xterm
    // in one write, and every gate below fails on their recorded numbers.
    //
    // The 40ms ceiling is not the target, it is the discriminator: a 16 KiB
    // element at the slowest live parse rate measured here (5.7 MB/s) is ~2.9ms,
    // so 40ms leaves an order of magnitude of CI noise while still failing on
    // both pre-fix readings.
    expect(live?.maxChars ?? 0).toBeLessThanOrEqual(BACKGROUND_CHUNK_CHARS)
    expect(bigWrites).toEqual([])
    expect(live?.maxActionMs ?? Number.POSITIVE_INFINITY).toBeLessThan(MAX_ELEMENT_PARSE_MS)
  } finally {
    await disposeSessions?.()
    await webClient?.dispose()
    await host.dispose()
  }
})

async function resetSchedulerDebug(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as SchedulerDebugWindow).__terminalOutputSchedulerDebug?.reset()
  })
}

async function readSchedulerDebug(page: Page): Promise<SchedulerDebugSnapshot | null> {
  return page.evaluate(
    () => (window as SchedulerDebugWindow).__terminalOutputSchedulerDebug?.snapshot() ?? null
  )
}
