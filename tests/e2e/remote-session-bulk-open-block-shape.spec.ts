/**
 * ORCA-230 — what shape is the ~1017ms main-thread block in R1's bulk open?
 *
 * The freeze oracle measures the gap between a sampler's own turns, and one
 * long task and a queue of short ones produce the same gap. This drives the
 * identical storm with the task trace instead of the sampler (they cannot share
 * a window: the sampler services tens of thousands of tasks a second and the
 * trace records one event per task) and reports task boundaries, which do
 * separate them.
 *
 * Run: CI Linux only — the paired web client does not hydrate `window.__store`
 * locally. `gh workflow run "E2E" -R ab2webco/orca-oss --ref <branch> -f ref=<branch>`
 */
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
  framesInsideTask,
  startRendererTaskTrace,
  stopRendererTaskTrace,
  worstBusyRun,
  type RendererTaskTraceHandle
} from './helpers/renderer-task-trace'

const POSITIVE_CONTROL_MS = 400
const CONTROL_WINDOW_MS = 1_500
/** Tasks worth naming inside the storm. */
const REPORTED_TASKS = 6

test('R1 bulk-open block shape @freeze-repro', async ({ testRepoPath }) => {
  test.setTimeout(420_000)
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

    webClient = await launchPairedWebClient(host.app, host.offer, {
      terminalParkingDelayMs: 500
    })
    const page = webClient.page
    await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 60_000 })
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().allWorktrees().length ?? 0), {
        timeout: 90_000
      })
      .toBeGreaterThan(0)

    const seeded = await seedBulkOpenRemoteSessions(page, { repoId: added.result.repo.id })
    disposeSessions = seeded.dispose

    await settleBeforeBulkOpen(page)

    // Positive control, in the same run that produces the measurement: a block
    // of known size must read at its size, or a small reading below means
    // nothing. Driven exactly like the storm, through the inspector.
    const controlTrace = await startRendererTaskTrace(page)
    await page.evaluate((blockMs) => {
      const until = performance.now() + blockMs
      while (performance.now() < until) {
        // Deliberate main-thread block of known size.
      }
    }, POSITIVE_CONTROL_MS)
    await page.waitForTimeout(CONTROL_WINDOW_MS)
    const control = worstBusyRun(await stopRendererTaskTrace(controlTrace))

    // Negative control: the same instrument over hidden streaming, no bulk open
    // inside it. Without this a large storm reading is not attributable.
    const hiddenTrace = await startRendererTaskTrace(page)
    await page.waitForTimeout(HIDDEN_FLOOD_WINDOW_MS)
    const hidden = worstBusyRun(await stopRendererTaskTrace(hiddenTrace))

    const stormTrace = await startRendererTaskTrace(page)
    const stormWallMs = await runBulkOpenStorm(page, seeded.sessions)
    const stormWindow = await stopRendererTaskTrace(stormTrace)
    const storm = worstBusyRun(stormWindow)

    console.log('[block-shape]', formatBusyRun(control, 'positive control'))
    console.log('[block-shape]', formatBusyRun(hidden, 'hidden streaming'))
    console.log('[block-shape]', formatBusyRun(storm, 'bulk open'))
    console.log(
      '[block-shape]',
      JSON.stringify(
        {
          stormWallMs,
          tracedEvents: stormWindow.eventCount,
          tracedTasks: stormWindow.tasks.length,
          anchored: stormWindow.anchored,
          notes: stormWindow.notes,
          positiveControlMs: Number(control.maxTaskMs.toFixed(1)),
          hiddenStreamingBusyRunMs: Number(hidden.busyRunMs.toFixed(1)),
          bulkOpen: {
            busyRunMs: Number(storm.busyRunMs.toFixed(1)),
            busyRunAtMs: Number(storm.startMs.toFixed(0)),
            tasksInRun: storm.taskCount,
            maxTaskMs: Number(storm.maxTaskMs.toFixed(1)),
            longestTaskFraction: Number(storm.longestTaskFraction.toFixed(3)),
            shape: storm.shape
          },
          longestTasks: describeLongestTasks(stormTrace, stormWindow.tasks)
        },
        null,
        2
      )
    )

    // Validity gates, not budgets: a reading from an instrument that measured
    // nothing is worse than no reading.
    expect(stormWindow.anchored).toBe(true)
    expect(control.maxTaskMs).toBeGreaterThanOrEqual(POSITIVE_CONTROL_MS * 0.8)
    expect(storm.taskCount).toBeGreaterThan(0)
  } finally {
    await disposeSessions?.()
    await webClient?.dispose()
    await host.dispose()
  }
})

function describeLongestTasks(
  handle: RendererTaskTraceHandle,
  tasks: { startMs: number; durationMs: number }[]
): unknown[] {
  return [...tasks]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, REPORTED_TASKS)
    .map((task) => ({
      durationMs: Number(task.durationMs.toFixed(1)),
      startMs: Number(task.startMs.toFixed(0)),
      inside: framesInsideTask(handle, task).map((frame) => ({
        name: frame.name,
        durationMs: Number(frame.durationMs.toFixed(1)),
        source: frame.source
      }))
    }))
}
