import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  profileWindow,
  selfTimeUnder,
  startRendererCpuProfile,
  stopRendererCpuProfile,
  type RendererProfileWindow
} from './helpers/renderer-cpu-profile'
import {
  startRendererTaskTrace,
  stopRendererTaskTrace,
  taskEventCensus,
  traceClockOffsetMs,
  worstBusyRun,
  type RendererTracedTask
} from './helpers/renderer-task-trace'

/**
 * Calibration for the task-attribution instrument (ORCA-239).
 *
 * The task trace says a task ran for N milliseconds. It does not say what ran,
 * and for the case that matters it cannot: work driven through the inspector
 * emits no `FunctionCall`, so its event census comes back empty. Every task in
 * R1's bulk-open storm is inspector-driven, which is why the storm's 217-235ms
 * tasks were unattributed and why a second gap-or-phase instrument would not
 * have helped.
 *
 * Each arm burns a known amount of time in a function with a known name and
 * requires the profiler to return that name against the window the trace
 * independently reports for the task. That comparison is also what establishes
 * the clock: the profile is on `TimeTicks` and the task list on
 * `performance.now()`, and an offset that were wrong would place the samples
 * outside the window and return nothing.
 *
 * The last check is the one ORCA-230 paid for — a probe can erase what it
 * observes. The same injection runs with the profiler off, and the traced task
 * has to read the same, or a profiled measurement measures the profiler.
 */

const SETTLE_MS = 1_500
const BURN_MS = 400
/** Sampling is coarse and the burn shares its task with the call into it. */
const MIN_ATTRIBUTED_FRACTION = 0.7
/** Profiling must not change the task it measures by more than this. */
const MAX_PERTURBATION_FRACTION = 0.2

type Arm = 'idle' | 'evaluate' | 'page-task'

type ArmResult = {
  arm: Arm
  taskMs: number
  profile: RendererProfileWindow
  burnSelfMs: number
  census: { name: string; count: number; totalMs: number }[]
}

const BURN_FUNCTION: Record<Arm, string> = {
  idle: 'orcaBurnInEvaluate',
  evaluate: 'orcaBurnInEvaluate',
  'page-task': 'orcaBurnInPageTask'
}

test('the cpu profile names the function that burned a traced task @freeze-repro', async ({
  orcaPage
}) => {
  test.setTimeout(300_000)
  await orcaPage.waitForTimeout(SETTLE_MS)

  const measured: ArmResult[] = []
  for (const arm of ['idle', 'evaluate', 'page-task'] as Arm[]) {
    measured.push(await measureArm(orcaPage, arm))
  }
  // Perturbation control on the arm the storm actually uses.
  const unprofiledTaskMs = await measureTaskWithoutProfiler(orcaPage)

  console.log(
    '[cpu-profile calibration]',
    JSON.stringify(
      {
        unprofiledEvaluateTaskMs: Number(unprofiledTaskMs.toFixed(1)),
        arms: measured.map((entry) => ({
          arm: entry.arm,
          tracedTaskMs: Number(entry.taskMs.toFixed(1)),
          attributed: entry.profile.attributed,
          samplesInTask: entry.profile.sampleCount,
          burnSelfMs: Number(entry.burnSelfMs.toFixed(1)),
          notes: entry.profile.notes,
          traceCensus: entry.census,
          top: entry.profile.frames.slice(0, 4)
        }))
      },
      null,
      2
    )
  )

  const arm = (label: Arm): ArmResult => {
    const found = measured.find((entry) => entry.arm === label)
    if (!found) {
      throw new Error(`cpu profile calibration lost arm ${label}`)
    }
    return found
  }

  // Negative control: nothing injected, so no frame may carry the burn's size.
  expect(arm('idle').burnSelfMs).toBeLessThan(BURN_MS * MIN_ATTRIBUTED_FRACTION)

  for (const label of ['evaluate', 'page-task'] as Arm[]) {
    const entry = arm(label)
    expect(entry.profile.attributed).toBe(true)
    expect(entry.taskMs).toBeGreaterThanOrEqual(BURN_MS * MIN_ATTRIBUTED_FRACTION)
    expect(entry.burnSelfMs).toBeGreaterThanOrEqual(entry.taskMs * MIN_ATTRIBUTED_FRACTION)
  }

  // What the profiler is here for: the trace can name the page task's handler
  // and cannot name the inspector's task at all.
  expect(arm('page-task').census.some((event) => event.name === 'FunctionCall')).toBe(true)
  expect(arm('evaluate').census).toEqual([])

  const drift = Math.abs(arm('evaluate').taskMs - unprofiledTaskMs) / unprofiledTaskMs
  expect(drift).toBeLessThan(MAX_PERTURBATION_FRACTION)
})

async function measureArm(page: Page, arm: Arm): Promise<ArmResult> {
  const trace = await startRendererTaskTrace(page)
  const cpu = await startRendererCpuProfile(page)
  await page.waitForTimeout(SETTLE_MS)
  const injectedAtMs = arm === 'idle' ? await pageNow(page) : await injectBurn(page, arm)
  await page.waitForTimeout(SETTLE_MS)
  const traced = await stopRendererTaskTrace(trace)
  await stopRendererCpuProfile(cpu)

  const task = longestTaskAfter(traced.tasks, injectedAtMs)
  const profile = task
    ? profileWindow(cpu, traceClockOffsetMs(trace), task.startMs, task.startMs + task.durationMs)
    : profileWindow(cpu, traceClockOffsetMs(trace), 0, 0)
  return {
    arm,
    taskMs: task?.durationMs ?? 0,
    profile,
    burnSelfMs: selfTimeUnder(profile, BURN_FUNCTION[arm]),
    census: task ? taskEventCensus(trace, task) : []
  }
}

async function measureTaskWithoutProfiler(page: Page): Promise<number> {
  const trace = await startRendererTaskTrace(page)
  await page.waitForTimeout(SETTLE_MS)
  await injectBurn(page, 'evaluate')
  await page.waitForTimeout(SETTLE_MS)
  return worstBusyRun(await stopRendererTaskTrace(trace)).maxTaskMs
}

/** Overlap, not start: the burn's own task began before it read the clock. */
function longestTaskAfter(
  tasks: RendererTracedTask[],
  fromMs: number
): RendererTracedTask | undefined {
  return [...tasks]
    .filter((task) => task.startMs + task.durationMs >= fromMs)
    .sort((a, b) => b.durationMs - a.durationMs)[0]
}

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now())
}

/** Returns the page's `performance.now()` immediately before the burn. */
async function injectBurn(page: Page, arm: Arm): Promise<number> {
  if (arm === 'page-task') {
    return page.evaluate(
      (burnMs) =>
        new Promise<number>((resolve) => {
          function orcaBurnInPageTask(): number {
            let acc = 0
            const until = performance.now() + burnMs
            while (performance.now() < until) {
              for (let i = 0; i < 5_000; i += 1) {
                acc += Math.sqrt(i)
              }
            }
            return acc
          }
          const channel = new MessageChannel()
          const startedAt = performance.now()
          channel.port1.onmessage = (): void => {
            orcaBurnInPageTask()
            channel.port1.close()
            channel.port2.close()
            resolve(startedAt)
          }
          channel.port2.postMessage(0)
        }),
      BURN_MS
    )
  }
  return page.evaluate((burnMs) => {
    function orcaBurnInEvaluate(): number {
      let acc = 0
      const until = performance.now() + burnMs
      while (performance.now() < until) {
        for (let i = 0; i < 5_000; i += 1) {
          acc += Math.sqrt(i)
        }
      }
      return acc
    }
    const startedAt = performance.now()
    orcaBurnInEvaluate()
    return startedAt
  }, BURN_MS)
}
