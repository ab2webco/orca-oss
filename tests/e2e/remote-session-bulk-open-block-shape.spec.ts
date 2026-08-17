/**
 * ORCA-230 — is a stall in R1's bulk open the product or the harness?
 *
 * On demand, not in the suite. It answers a question rather than guarding a
 * regression, and it costs a full paired host plus a seeded storm.
 *
 * What it measures: task boundaries, not the gap between a sampler's own turns.
 * One long synchronous task and a queue of short ones produce the same gap and
 * do not have the same fix, so the freeze oracle's number cannot tell them
 * apart on its own. Calibrated in renderer-task-trace-calibration.spec.ts.
 *
 * What it found, and why it stays as the control: with the paired client's
 * window never shown, the storm contains two tasks of 1017.8 and 1017.3ms whose
 * only child is a ~1004ms compositor `Commit`. Showing the window, or driving
 * one second of animation frames beforehand, replaces them with a saturated
 * queue whose longest task is 217-235ms — while the untouched oracle in the
 * same shard still read 1021ms. That block is the harness, and this spec is
 * what re-establishes it: it must keep reporting a ~1017ms contiguous task
 * against a never-shown window, and the oracle must stop reporting one.
 *
 * Run: CI Linux only — the paired web client does not hydrate `window.__store`
 * locally.
 *   pnpm exec playwright test tests/e2e/remote-session-bulk-open-block-shape.spec.ts \
 *     --config tests/playwright.config.ts --project electron-headless --grep @ondemand
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
  framesInsideTask,
  startRendererTaskTrace,
  stopRendererTaskTrace,
  worstBusyRun,
  type RendererTaskTraceHandle,
  type RendererTracedTask
} from './helpers/renderer-task-trace'

const POSITIVE_CONTROL_MS = 400
const CONTROL_WINDOW_MS = 1_500
const FRAME_PROBE_MS = 1_000
/** Tasks worth naming inside the storm. */
const REPORTED_TASKS = 4

test('R1 bulk-open block shape against a never-shown window @ondemand @freeze-repro', async ({
  testRepoPath
}) => {
  test.setTimeout(600_000)
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

    // Never shown, which is the condition under test.
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
    // of known size must read at its size, or a small reading means nothing.
    // Driven exactly like the storm, through the inspector.
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

    // Only now: driving frames removes the very block this spec exists to show,
    // so counting them cannot happen before the measurement.
    const framesPerSecondAfterStorm = await countDeliveredFrames(page)

    console.log('[block-shape]', formatBusyRun(control, 'positive control'))
    console.log('[block-shape]', formatBusyRun(hidden, 'hidden streaming'))
    console.log('[block-shape]', formatBusyRun(storm, 'bulk open'))
    console.log(
      '[block-shape]',
      JSON.stringify(
        {
          stormWallMs,
          framesPerSecondAfterStorm,
          tracedTasks: stormWindow.tasks.length,
          anchored: stormWindow.anchored,
          notes: stormWindow.notes,
          control,
          hidden,
          storm,
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

/** Animation frames Chromium delivers in a second — a never-shown window reads ~1. */
async function countDeliveredFrames(page: Page): Promise<number> {
  return page.evaluate(
    (windowMs) =>
      new Promise<number>((resolve) => {
        let frames = 0
        let running = true
        const tick = (): void => {
          frames += 1
          if (running) {
            requestAnimationFrame(tick)
          }
        }
        requestAnimationFrame(tick)
        setTimeout(() => {
          running = false
          resolve(frames)
        }, windowMs)
      }),
    FRAME_PROBE_MS
  )
}

function describeLongestTasks(
  handle: RendererTaskTraceHandle,
  tasks: RendererTracedTask[]
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
