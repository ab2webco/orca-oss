/**
 * ORCA-239 — what burns the longest task in R1's bulk open?
 *
 * On demand, not in the suite: it answers a question rather than guarding a
 * regression, and it costs a paired host and a seeded storm per arm.
 *
 * ORCA-230 established that the ~1017ms block against a never-shown window is
 * the harness — one compositor `Commit` on a window that never produced a
 * frame. With the window shown, what is left is real: a busy run of 1.1-1.2s
 * whose longest single task is 217-235ms, and that task has never been named.
 *
 * Two instruments, because they answer different halves. The trace, once it
 * records `devtools.timeline`, names the task's entry point and the Blink
 * phases it enters. V8 stack sampling over the same window names what ran
 * inside it, which the trace cannot say at any category setting.
 *
 * What they found (run 31965460025): the storm's long tasks are two different
 * things. The longest, 214-250ms, is one React commit that mounts terminal
 * panes — 93% under react-dom's commit phase, and diffuse inside it, no leaf
 * above 11ms. The next tier, 123-128ms, is a `TimerFire` into xterm's
 * `_innerWrite` -> `parse` -> `print`/`scroll` at 94% of the task, entered from
 * pane-terminal-output-scheduler.ts:854.
 *
 * Four arms, one storm each:
 *
 * - `never-shown, ORCA-230 categories` and `never-shown` differ only in what
 *   the trace records. They are the equivalence control for this ticket's
 *   category addition, decided against each other on one runner rather than
 *   against ORCA-230's recorded numbers, because the ghost is a compositor
 *   wait and machine load is not a constant across runs.
 * - `shown` is the regime a user is in, measured with the profiler off.
 * - `shown, profiled` is the same regime with sampling on. It injects the
 *   400ms control twice, once profiled and once not, so perturbation is read
 *   on one page instead of across two hosts. ORCA-230 lost a phenomenon to an
 *   observation, so this is an arm, not a note.
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
  expectedSampleCount,
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
  PRE_ORCA_239_TRACE_CATEGORIES,
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
/** A window sampled below this share of what it is owed was not really sampled. */
const MIN_SAMPLE_DENSITY = 0.5
/** Profiling must not change the injected block it measures by more than this. */
const MAX_PERTURBATION_FRACTION = 0.1
/** Tasks worth naming inside the storm. */
const REPORTED_TASKS = 3
/** ORCA-230's never-shown compositor block, which reproduces at 1016.6-1018.0ms. */
const GHOST_TASK_MS = 900

type Arm = { label: string; shown: boolean; profiled: boolean; categories?: string[] }

type AttributedTask = {
  durationMs: number
  startMs: number
  inside: { name: string; durationMs: number; source: string | null }[]
  census: { name: string; count: number; totalMs: number }[]
  profile: RendererProfileWindow['frames'] | null
  owners: RendererProfileWindow['subtrees'] | null
  samplesInTask: number | null
}

type ArmMeasurement = Arm & {
  framesPerSecondAfterStorm: number
  control: RendererBusyRun
  controlAttributedMs: number | null
  controlProfile: RendererProfileWindow | null
  /** Same injection, same page, profiler stopped: the paired perturbation read. */
  controlUnprofiledMs: number | null
  hidden: RendererBusyRun
  storm: RendererBusyRun
  stormWallMs: number
  tracedTasks: number
  anchored: boolean
  longestTasks: AttributedTask[]
}

const ARMS: Arm[] = [
  {
    label: 'never-shown, ORCA-230 categories',
    shown: false,
    profiled: false,
    categories: PRE_ORCA_239_TRACE_CATEGORIES
  },
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

  // Equivalence for this ticket's category addition, as a per-arm invariant
  // rather than a comparison between the two arms: whichever set is recording,
  // a ghost task must still come back with its `Commit` child. Comparing the
  // arms to each other only works in a run where both reproduced it, and that
  // is not every run. Both did in 31964367676 (1018.0/Commit 1004.2 against
  // 1018.0/Commit 1001.3) and 31964719937 (1017.3/1002.9 against 1017.1/1001.1).
  const ghostArms = [arm('never-shown, ORCA-230 categories'), arm('never-shown')]
  for (const entry of ghostArms) {
    const longest = entry.longestTasks[0]
    if (longest.durationMs < GHOST_TASK_MS) {
      // Not deterministic: run 31963571496 produced no ghost in either arm, and
      // 31965091901 in only one. An arm that did not produce it cannot speak to
      // whether the instrument still attributes it.
      console.log(`[task-attribution] ${entry.label} produced no ghost this run`)
      continue
    }
    expect(longest.inside[0]?.name).toBe('Commit')
    expect(longest.inside[0]?.durationMs).toBeGreaterThan(GHOST_TASK_MS)
  }

  // The profiler found the injected block in the profiled arm's own run, and
  // sampled densely enough that "found" means the window and not one sample.
  const profiled = arm('shown, profiled')
  const controlSamples = profiled.controlProfile?.sampleCount ?? 0
  expect(controlSamples).toBeGreaterThan(
    expectedSampleCount(profiled.control.maxTaskMs) * MIN_SAMPLE_DENSITY
  )
  expect(profiled.controlAttributedMs).toBeGreaterThanOrEqual(
    POSITIVE_CONTROL_MS * MIN_ATTRIBUTED_FRACTION
  )
  const longest = profiled.longestTasks[0]
  expect(longest?.samplesInTask ?? 0).toBeGreaterThan(
    expectedSampleCount(longest?.durationMs ?? 0) * MIN_SAMPLE_DENSITY
  )

  // Perturbation control: sampling must not be what the storm is measuring.
  // Decided on the injected 400ms block and not on the storm's busy run —
  // ORCA-230 measured that quantity at 507.0 to 1725.7ms across seven runs
  // with no profiler anywhere, so a threshold on it would answer noise.
  const unprofiledControlMs = profiled.controlUnprofiledMs ?? 0
  const controlDrift =
    Math.abs(profiled.control.maxTaskMs - unprofiledControlMs) / unprofiledControlMs
  expect(controlDrift).toBeLessThan(MAX_PERTURBATION_FRACTION)
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

    // One profile for the whole arm, opened before the settle so the sampler has
    // seconds to come up. A session opened just before each phase does not
    // sample it: 500ms after `Profiler.start` a 400ms block still came back
    // with one sample and nothing attributed (run 31964719937).
    const cpu = arm.profiled ? await startRendererCpuProfile(page) : null

    await settleBeforeBulkOpen(page)

    // Positive control, in the same run that produces the measurement: a block
    // of known size must read at its size, and in the profiled arm it must also
    // come back under its own name, or a small reading means nothing.
    const controlTrace = await startRendererTaskTrace(page, { categories: arm.categories })
    await injectPositiveControl(page)
    await page.waitForTimeout(CONTROL_WINDOW_MS)
    const controlWindow = await stopRendererTaskTrace(controlTrace)
    const control = worstBusyRun(controlWindow)

    // Negative control: the same instruments over hidden streaming, no bulk
    // open inside. Without it a large storm reading is not attributable.
    const hiddenTrace = await startRendererTaskTrace(page, { categories: arm.categories })
    await page.waitForTimeout(HIDDEN_FLOOD_WINDOW_MS)
    const hidden = worstBusyRun(await stopRendererTaskTrace(hiddenTrace))

    const stormTrace = await startRendererTaskTrace(page, { categories: arm.categories })
    const stormWallMs = await runBulkOpenStorm(page, seeded.sessions)
    const stormWindow = await stopRendererTaskTrace(stormTrace)
    const storm = worstBusyRun(stormWindow)
    if (cpu) {
      await stopRendererCpuProfile(cpu)
    }
    const controlProfile = cpu ? controlProfileWindow(cpu, controlTrace, controlWindow.tasks) : null
    const controlAttributedMs = controlProfile
      ? Number(selfTimeUnder(controlProfile, CONTROL_FUNCTION).toFixed(1))
      : null

    // The same injection again with the profiler stopped, on this same page and
    // host. Comparing two arms would compare two machines.
    let controlUnprofiledMs: number | null = null
    if (arm.profiled) {
      const repeatTrace = await startRendererTaskTrace(page, { categories: arm.categories })
      await injectPositiveControl(page)
      await page.waitForTimeout(CONTROL_WINDOW_MS)
      controlUnprofiledMs = worstBusyRun(await stopRendererTaskTrace(repeatTrace)).maxTaskMs
    }

    // Only now: driving frames removes the very block the never-shown arm
    // exists to reproduce, so counting them cannot happen before the storm.
    const framesPerSecondAfterStorm = await countDeliveredFrames(page)

    console.log('[task-attribution]', formatBusyRun(control, `${arm.label} positive control`))
    console.log('[task-attribution]', formatBusyRun(hidden, `${arm.label} hidden streaming`))
    console.log('[task-attribution]', formatBusyRun(storm, `${arm.label} bulk open`))
    console.log(
      '[task-attribution]',
      `${arm.label} framesAfter=${framesPerSecondAfterStorm}/s ` +
        `controlAttributed=${controlAttributedMs} controlUnprofiled=${controlUnprofiledMs}`
    )

    return {
      ...arm,
      framesPerSecondAfterStorm,
      control,
      controlAttributedMs,
      controlProfile,
      controlUnprofiledMs,
      hidden,
      storm,
      stormWallMs,
      tracedTasks: stormWindow.tasks.length,
      anchored: stormWindow.anchored,
      longestTasks: describeLongestTasks(stormTrace, cpu, stormWindow.tasks)
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

function controlProfileWindow(
  cpu: RendererCpuProfileHandle,
  trace: RendererTaskTraceHandle,
  tasks: RendererTracedTask[]
): RendererProfileWindow | null {
  const task = [...tasks].sort((a, b) => b.durationMs - a.durationMs)[0]
  if (!task) {
    return null
  }
  return profileWindow(cpu, traceClockOffsetMs(trace), task.startMs, task.startMs + task.durationMs)
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
        owners: profile?.subtrees ?? null,
        samplesInTask: profile?.sampleCount ?? null
      }
    })
}
