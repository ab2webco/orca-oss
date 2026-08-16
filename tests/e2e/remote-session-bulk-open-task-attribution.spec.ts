/**
 * ORCA-239 — what burns the longest task in R1's bulk open?
 *
 * On demand, not in the suite: it answers a question rather than guarding a
 * regression, and it costs a paired host and a seeded storm per arm.
 *
 * ORCA-230 established that the ~1017ms block against a never-shown window is
 * the harness — one compositor `Commit` on a window that never produced a
 * frame. With the window shown, what is left is real: a busy run of 1.1-1.2s
 * whose longest single task is 217-235ms. That task has never been attributed,
 * because the trace cannot attribute it: the storm drives every tab through
 * `page.evaluate`, and inspector-driven work emits no `FunctionCall` (measured
 * in renderer-cpu-profile-calibration.spec.ts). This adds V8 stack sampling
 * over the same window and names the frames.
 *
 * Three arms, one storm each:
 *
 * - `never-shown` reproduces ORCA-230's ghost, and exists here as the
 *   equivalence control for this ticket's change to the trace's categories: it
 *   must still read ~1017ms with a ~1004ms `Commit` child, or the instrument
 *   lost the attribution it already had.
 * - `shown` is the regime a user is in, measured with the profiler off.
 * - `shown, profiled` is the same regime with sampling on. Its busy run and
 *   longest task must match the arm above, or the reading is of the profiler.
 *   ORCA-230 lost a phenomenon to exactly this, so it is an arm, not a note.
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
  profileWindow,
  selfTimeUnder,
  startRendererCpuProfile,
  stopRendererCpuProfile,
  type RendererCpuProfileHandle,
  type RendererProfileWindow
} from './helpers/renderer-cpu-profile'
import {
  formatBusyRun,
  framesInsideTask,
  startRendererTaskTrace,
  stopRendererTaskTrace,
  taskEventCensus,
  traceClockOffsetMs,
  worstBusyRun,
  type RendererBusyRun,
  type RendererTaskTraceHandle,
  type RendererTracedTask
} from './helpers/renderer-task-trace'

const POSITIVE_CONTROL_MS = 400
const CONTROL_WINDOW_MS = 1_500
const FRAME_PROBE_MS = 1_000
const CONTROL_FUNCTION = 'orcaBulkOpenPositiveControl'
/** Sampling is coarse and the burn shares its task with the call into it. */
const MIN_ATTRIBUTED_FRACTION = 0.7
/** Profiling must not change the storm it measures by more than this. */
const MAX_PERTURBATION_FRACTION = 0.35
/** Tasks worth naming inside the storm. */
const REPORTED_TASKS = 3

type Arm = { label: string; shown: boolean; profiled: boolean }

type AttributedTask = {
  durationMs: number
  startMs: number
  inside: { name: string; durationMs: number; source: string | null }[]
  census: { name: string; count: number; totalMs: number }[]
  profile: RendererProfileWindow['frames'] | null
  samplesInTask: number | null
}

type ArmMeasurement = Arm & {
  framesPerSecondAfterStorm: number
  control: RendererBusyRun
  controlAttributedMs: number | null
  hidden: RendererBusyRun
  storm: RendererBusyRun
  stormWallMs: number
  tracedTasks: number
  anchored: boolean
  longestTasks: AttributedTask[]
}

const ARMS: Arm[] = [
  { label: 'never-shown', shown: false, profiled: false },
  { label: 'shown', shown: true, profiled: false },
  { label: 'shown, profiled', shown: true, profiled: true }
]

test('R1 bulk-open longest task, attributed @ondemand @freeze-repro', async ({ testRepoPath }) => {
  test.setTimeout(900_000)

  const arms: ArmMeasurement[] = []
  for (const arm of ARMS) {
    arms.push(await measureArm(testRepoPath, arm))
  }
  console.log('[task-attribution]', JSON.stringify(arms, null, 2))

  const arm = (label: string): ArmMeasurement => {
    const found = arms.find((entry) => entry.label === label)
    if (!found) {
      throw new Error(`task attribution experiment lost arm ${label}`)
    }
    return found
  }

  // Validity gates. A reading from an instrument that measured nothing is
  // worse than no reading.
  for (const entry of arms) {
    expect(entry.anchored).toBe(true)
    expect(entry.control.maxTaskMs).toBeGreaterThanOrEqual(POSITIVE_CONTROL_MS * 0.8)
    expect(entry.storm.taskCount).toBeGreaterThan(0)
  }

  // The trace still attributes what ORCA-230 attributed with it: the ghost's
  // total AND its `Commit` child, not just a similar number.
  const ghost = arm('never-shown').longestTasks[0]
  expect(ghost.durationMs).toBeGreaterThan(900)
  expect(ghost.inside[0]?.name).toBe('Commit')
  expect(ghost.inside[0]?.durationMs).toBeGreaterThan(900)

  // The profiler found the injected block in the profiled arm's own run.
  const profiled = arm('shown, profiled')
  expect(profiled.controlAttributedMs).toBeGreaterThanOrEqual(
    POSITIVE_CONTROL_MS * MIN_ATTRIBUTED_FRACTION
  )
  expect(profiled.longestTasks[0]?.samplesInTask ?? 0).toBeGreaterThan(0)

  // Perturbation control: sampling must not be what the storm is measuring.
  const unprofiled = arm('shown')
  const drift =
    Math.abs(profiled.storm.busyRunMs - unprofiled.storm.busyRunMs) / unprofiled.storm.busyRunMs
  expect(drift).toBeLessThan(MAX_PERTURBATION_FRACTION)
})

async function measureArm(testRepoPath: string, arm: Arm): Promise<ArmMeasurement> {
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
      showWindow: arm.shown
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
    // of known size must read at its size, and in the profiled arm it must also
    // come back under its own name, or a small reading means nothing.
    const controlTrace = await startRendererTaskTrace(page)
    const controlCpu = arm.profiled ? await startRendererCpuProfile(page) : null
    await injectPositiveControl(page)
    await page.waitForTimeout(CONTROL_WINDOW_MS)
    const controlWindow = await stopRendererTaskTrace(controlTrace)
    if (controlCpu) {
      await stopRendererCpuProfile(controlCpu)
    }
    const control = worstBusyRun(controlWindow)
    const controlAttributedMs = controlCpu
      ? attributedControlMs(controlCpu, controlTrace, controlWindow.tasks)
      : null

    // Negative control: the same instruments over hidden streaming, no bulk
    // open inside. Without it a large storm reading is not attributable.
    const hiddenTrace = await startRendererTaskTrace(page)
    await page.waitForTimeout(HIDDEN_FLOOD_WINDOW_MS)
    const hidden = worstBusyRun(await stopRendererTaskTrace(hiddenTrace))

    const stormTrace = await startRendererTaskTrace(page)
    const stormCpu = arm.profiled ? await startRendererCpuProfile(page) : null
    const stormWallMs = await runBulkOpenStorm(page, seeded.sessions)
    const stormWindow = await stopRendererTaskTrace(stormTrace)
    if (stormCpu) {
      await stopRendererCpuProfile(stormCpu)
    }
    const storm = worstBusyRun(stormWindow)

    // Only now: driving frames removes the very block the never-shown arm
    // exists to reproduce, so counting them cannot happen before the storm.
    const framesPerSecondAfterStorm = await countDeliveredFrames(page)

    console.log('[task-attribution]', formatBusyRun(control, `${arm.label} positive control`))
    console.log('[task-attribution]', formatBusyRun(hidden, `${arm.label} hidden streaming`))
    console.log('[task-attribution]', formatBusyRun(storm, `${arm.label} bulk open`))
    console.log(
      '[task-attribution]',
      `${arm.label} framesAfter=${framesPerSecondAfterStorm}/s controlAttributed=${controlAttributedMs}`
    )

    return {
      ...arm,
      framesPerSecondAfterStorm,
      control,
      controlAttributedMs,
      hidden,
      storm,
      stormWallMs,
      tracedTasks: stormWindow.tasks.length,
      anchored: stormWindow.anchored,
      longestTasks: describeLongestTasks(stormTrace, stormCpu, stormWindow.tasks)
    }
  } finally {
    await disposeSessions?.()
    await webClient?.dispose()
    await host.dispose()
  }
}

/** Driven through the inspector, exactly like the storm. */
async function injectPositiveControl(page: Page): Promise<void> {
  await page.evaluate((blockMs) => {
    function orcaBulkOpenPositiveControl(): number {
      let acc = 0
      const until = performance.now() + blockMs
      while (performance.now() < until) {
        for (let i = 0; i < 5_000; i += 1) {
          acc += Math.sqrt(i)
        }
      }
      return acc
    }
    return orcaBulkOpenPositiveControl()
  }, POSITIVE_CONTROL_MS)
}

function attributedControlMs(
  cpu: RendererCpuProfileHandle,
  trace: RendererTaskTraceHandle,
  tasks: RendererTracedTask[]
): number | null {
  const task = [...tasks].sort((a, b) => b.durationMs - a.durationMs)[0]
  if (!task) {
    return null
  }
  const window = profileWindow(
    cpu,
    traceClockOffsetMs(trace),
    task.startMs,
    task.startMs + task.durationMs
  )
  return Number(selfTimeUnder(window, CONTROL_FUNCTION).toFixed(1))
}

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
  trace: RendererTaskTraceHandle,
  cpu: RendererCpuProfileHandle | null,
  tasks: RendererTracedTask[]
): AttributedTask[] {
  const offsetMs = traceClockOffsetMs(trace)
  return [...tasks]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, REPORTED_TASKS)
    .map((task) => {
      const profile = cpu
        ? profileWindow(cpu, offsetMs, task.startMs, task.startMs + task.durationMs)
        : null
      return {
        durationMs: Number(task.durationMs.toFixed(1)),
        startMs: Number(task.startMs.toFixed(0)),
        inside: framesInsideTask(trace, task).map((frame) => ({
          name: frame.name,
          durationMs: Number(frame.durationMs.toFixed(1)),
          source: frame.source
        })),
        census: taskEventCensus(trace, task),
        profile: profile?.frames ?? null,
        samplesInTask: profile?.sampleCount ?? null
      }
    })
}
