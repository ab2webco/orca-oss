/**
 * ORCA-230 — what shape is the ~1017ms main-thread block in R1's bulk open,
 * and is it the product or the harness?
 *
 * The freeze oracle measures the gap between a sampler's own turns, and one
 * long task and a queue of short ones produce the same gap. This drives the
 * identical storm with the task trace instead of the sampler (they cannot share
 * a window: the sampler services tens of thousands of tasks a second and the
 * trace records one event per task) and reports task boundaries, which do
 * separate them.
 *
 * The first measurement found one contiguous 1017.7ms task whose only child was
 * a 1003.8ms `Commit` — the main thread waiting on the compositor, not JS. The
 * paired client's window is never shown, so Chromium composites nothing for it.
 *
 * The three arms below run the same storm and differ only in what the window
 * did before it. The middle one exists because it was found by accident: adding
 * a one-second `requestAnimationFrame` loop before the storm — meant only to
 * observe whether the window composites — removed the block, while the
 * untouched oracle in the same shard still read 1017.4ms. So the probe is an
 * arm, not an observation, and `cold` keeps the sequence that reproduced it.
 * Frames are counted after the storm precisely so counting cannot perturb it.
 *
 * Run: CI Linux only — the paired web client does not hydrate `window.__store`
 * locally. `gh workflow run "E2E" -R ab2webco/orca-oss --ref <branch> -f ref=<branch>`
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
  type RendererBusyRun,
  type RendererTaskTraceHandle,
  type RendererTracedTask
} from './helpers/renderer-task-trace'

const POSITIVE_CONTROL_MS = 400
const CONTROL_WINDOW_MS = 1_500
const FRAME_PROBE_MS = 1_000
/** Tasks worth naming inside the storm. */
const REPORTED_TASKS = 4

type Arm = {
  label: string
  shown: boolean
  /** Drive animation frames before the storm — the manipulation, not a reading. */
  warmFrames: boolean
}

type ArmMeasurement = Arm & {
  framesPerSecondAfterStorm: number
  control: RendererBusyRun
  hidden: RendererBusyRun
  storm: RendererBusyRun
  stormWallMs: number
  tracedTasks: number
  anchored: boolean
  longestTasks: unknown[]
}

const ARMS: Arm[] = [
  { label: 'never-shown, cold', shown: false, warmFrames: false },
  { label: 'never-shown, frames driven first', shown: false, warmFrames: true },
  { label: 'shown window', shown: true, warmFrames: false }
]

test('R1 bulk-open block shape against window compositing state @freeze-repro', async ({
  testRepoPath
}) => {
  test.setTimeout(1_200_000)
  const arms: ArmMeasurement[] = []
  for (const arm of ARMS) {
    arms.push(await measureArm(testRepoPath, arm))
  }

  console.log('[block-shape]', JSON.stringify(arms, null, 2))

  // Validity gates, not budgets. A reading from an instrument that measured
  // nothing is worse than no reading, and "the window composites" has to be an
  // observation before any arm's Commit means anything.
  for (const arm of arms) {
    expect(arm.anchored).toBe(true)
    expect(arm.control.maxTaskMs).toBeGreaterThanOrEqual(POSITIVE_CONTROL_MS * 0.8)
    expect(arm.storm.taskCount).toBeGreaterThan(0)
  }
  const shown = arms.find((arm) => arm.shown)
  const cold = arms.find((arm) => !arm.shown && !arm.warmFrames)
  if (!shown || !cold) {
    throw new Error('block-shape experiment lost an arm')
  }
  expect(shown.framesPerSecondAfterStorm).toBeGreaterThan(cold.framesPerSecondAfterStorm)
})

async function measureArm(testRepoPath: string, arm: Arm): Promise<ArmMeasurement> {
  const { label, shown } = arm
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
      terminalParkingDelayMs: 500,
      showWindow: shown
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

    if (arm.warmFrames) {
      await countDeliveredFrames(page)
    }

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

    // Only now: driving frames is a manipulation, so it cannot happen before
    // the measurement in an arm that is supposed to be cold.
    const framesPerSecondAfterStorm = await countDeliveredFrames(page)

    console.log('[block-shape]', formatBusyRun(control, `${label} positive control`))
    console.log('[block-shape]', formatBusyRun(hidden, `${label} hidden streaming`))
    console.log('[block-shape]', formatBusyRun(storm, `${label} bulk open`))
    console.log(
      '[block-shape]',
      `${label} framesAfter=${framesPerSecondAfterStorm}/s shown=${shown} warmFrames=${arm.warmFrames}`
    )

    return {
      ...arm,
      framesPerSecondAfterStorm,
      control,
      hidden,
      storm,
      stormWallMs,
      tracedTasks: stormWindow.tasks.length,
      anchored: stormWindow.anchored,
      longestTasks: describeLongestTasks(stormTrace, stormWindow.tasks)
    }
  } finally {
    await disposeSessions?.()
    await webClient?.dispose()
    await host.dispose()
  }
}

/** Animation frames Chromium delivers in a second — 0 means it composites nothing. */
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
