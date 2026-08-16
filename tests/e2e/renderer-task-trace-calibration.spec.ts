import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  readRendererBlockWindow,
  startRendererMainThreadBlockProbe
} from './helpers/renderer-main-thread-block-probe'
import {
  formatBusyRun,
  startRendererTaskTrace,
  stopRendererTaskTrace,
  worstBusyRun,
  type RendererBusyRun
} from './helpers/renderer-task-trace'

/**
 * Calibration for the block-shape instrument (ORCA-230).
 *
 * The freeze oracles report one number: the longest gap between the block
 * sampler's own turns. Two different faults produce the same number — one long
 * synchronous task, or a queue kept full by shorter ones — and a second gap
 * sampler cannot separate them because it measures the same quantity. Each arm
 * here injects one fault at the same total size and requires the sampler to
 * read them alike while the trace reads them apart.
 *
 * The two instruments run in separate passes on purpose: the sampler services
 * tens of thousands of tasks a second and the trace records one event per task.
 *
 * `contiguous-evaluate` is the harness's own driving mode, so it is calibrated
 * rather than assumed: work run by the inspector is invisible to
 * `PerformanceObserver('longtask')` — measured 0 entries for a 900ms block —
 * which is why that observer is not the instrument here.
 */

const WINDOW_HALF_MS = 1_500
const INJECTED_TOTAL_MS = 900
const LONG_CHUNKS = 12
const SHORT_CHUNKS = 30
/** Injection is serviced as queued work, so the stall it makes is never the full total. */
const MIN_INJECTED_FRACTION = 0.5

type Injection = 'none' | 'contiguous-task' | 'contiguous-evaluate' | 'long-chunks' | 'short-chunks'

const ARMS: { label: string; inject: Injection }[] = [
  { label: 'idle', inject: 'none' },
  { label: 'contiguous-task', inject: 'contiguous-task' },
  { label: 'contiguous-evaluate', inject: 'contiguous-evaluate' },
  { label: 'long-chunks', inject: 'long-chunks' },
  { label: 'short-chunks', inject: 'short-chunks' }
]

type ArmResult = { label: string; gapMs: number; run: RendererBusyRun; anchored: boolean }

test('the task trace tells one long task from a starved queue the sampler reads alike @freeze-repro', async ({
  orcaPage
}) => {
  test.setTimeout(300_000)

  // Same reason as the block-probe calibration: the first window after the app
  // opens carries its own settling work.
  await orcaPage.waitForTimeout(WINDOW_HALF_MS)

  const measured: ArmResult[] = []
  for (const arm of ARMS) {
    const probe = await startRendererMainThreadBlockProbe(orcaPage)
    await orcaPage.waitForTimeout(WINDOW_HALF_MS)
    await injectBlock(orcaPage, arm.inject)
    await orcaPage.waitForTimeout(WINDOW_HALF_MS)
    const block = await readRendererBlockWindow(probe, arm.label)
    await probe.dispose()

    const trace = await startRendererTaskTrace(orcaPage)
    await orcaPage.waitForTimeout(WINDOW_HALF_MS)
    await injectBlock(orcaPage, arm.inject)
    await orcaPage.waitForTimeout(WINDOW_HALF_MS)
    const traced = await stopRendererTaskTrace(trace)
    const run = worstBusyRun(traced)

    console.log('[trace calibration]', formatBusyRun(run, arm.label))
    measured.push({ label: arm.label, gapMs: block.maxBlockMs, run, anchored: traced.anchored })
  }

  console.log(
    '[trace calibration]',
    JSON.stringify(
      measured.map((entry) => ({
        arm: entry.label,
        samplerGapMs: Number(entry.gapMs.toFixed(1)),
        anchored: entry.anchored,
        busyRunMs: Number(entry.run.busyRunMs.toFixed(1)),
        tasksInRun: entry.run.taskCount,
        maxTaskMs: Number(entry.run.maxTaskMs.toFixed(1)),
        shape: entry.run.shape
      })),
      null,
      2
    )
  )

  const arm = (label: string): ArmResult => {
    const found = measured.find((entry) => entry.label === label)
    if (!found) {
      throw new Error(`trace calibration lost arm ${label}`)
    }
    return found
  }
  const idle = arm('idle')
  const contiguousTask = arm('contiguous-task')
  const contiguousEvaluate = arm('contiguous-evaluate')
  const longChunks = arm('long-chunks')
  const shortChunks = arm('short-chunks')
  const minInjectedMs = INJECTED_TOTAL_MS * MIN_INJECTED_FRACTION

  // Negative control: nothing injected, so neither instrument may report one.
  expect(idle.gapMs).toBeLessThan(minInjectedMs)
  expect(idle.run.maxTaskMs).toBeLessThan(minInjectedMs)

  // Positive control. Without it every small reading below is
  // indistinguishable from an instrument that never ran.
  for (const contiguous of [contiguousTask, contiguousEvaluate]) {
    expect(contiguous.anchored).toBe(true)
    expect(contiguous.gapMs).toBeGreaterThanOrEqual(minInjectedMs)
    expect(contiguous.run.busyRunMs).toBeGreaterThanOrEqual(minInjectedMs)
    expect(contiguous.run.maxTaskMs).toBeGreaterThanOrEqual(minInjectedMs)
    expect(contiguous.run.shape).toBe('contiguous')
  }

  // The discrimination the instrument exists for: the sampler reads a stall of
  // the same size as the contiguous arms, the trace reads many tasks.
  expect(longChunks.gapMs).toBeGreaterThanOrEqual(minInjectedMs)
  expect(longChunks.run.busyRunMs).toBeGreaterThanOrEqual(minInjectedMs)
  expect(longChunks.run.taskCount).toBeGreaterThanOrEqual(LONG_CHUNKS / 2)
  expect(longChunks.run.maxTaskMs).toBeLessThan(longChunks.run.busyRunMs / 2)
  expect(longChunks.run.shape).toBe('saturated-queue')

  // And it keeps resolving below the 50ms floor that would blind a longtask
  // observer, which is what makes a "many short tasks" reading believable.
  expect(shortChunks.gapMs).toBeGreaterThanOrEqual(minInjectedMs)
  expect(shortChunks.run.taskCount).toBeGreaterThanOrEqual(SHORT_CHUNKS / 2)
  expect(shortChunks.run.maxTaskMs).toBeLessThan(shortChunks.run.busyRunMs / 4)
  expect(shortChunks.run.shape).toBe('saturated-queue')
})

async function injectBlock(page: Page, injection: Injection): Promise<void> {
  if (injection === 'none') {
    return
  }
  if (injection === 'contiguous-evaluate') {
    await page.evaluate((blockMs) => {
      const until = performance.now() + blockMs
      while (performance.now() < until) {
        // One task of known size, run by the inspector rather than by the page.
      }
    }, INJECTED_TOTAL_MS)
    return
  }
  const chunks =
    injection === 'contiguous-task' ? 1 : injection === 'long-chunks' ? LONG_CHUNKS : SHORT_CHUNKS
  await page.evaluate(
    ({ chunks, chunkMs }) =>
      // Posted as one batch so every chunk is queued ahead of anything posted
      // after it: same total work, same stall, a known number of tasks.
      new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        let done = 0
        channel.port1.onmessage = (): void => {
          const until = performance.now() + chunkMs
          while (performance.now() < until) {
            // Deliberate task of known size.
          }
          done += 1
          if (done === chunks) {
            channel.port1.close()
            channel.port2.close()
            resolve()
          }
        }
        for (let i = 0; i < chunks; i += 1) {
          channel.port2.postMessage(i)
        }
      }),
    { chunks, chunkMs: INJECTED_TOTAL_MS / chunks }
  )
}
