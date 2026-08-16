import type { CDPSession, Page } from '@stablyai/playwright-test'

/** One main-thread task, on `performance.now()`'s scale. */
export type RendererTracedTask = {
  startMs: number
  durationMs: number
}

export type RendererTracedFrame = {
  name: string
  durationMs: number
  /** `functionName file:line` when the trace event carries a call frame. */
  source: string | null
}

export type RendererTaskTraceWindow = {
  /** False when no anchor mark was traced — the task list cannot be placed or attributed. */
  anchored: boolean
  tasks: RendererTracedTask[]
  eventCount: number
  notes: string[]
}

/**
 * The shape of a stretch where the main thread never went idle.
 *
 * `maxBusyRunMs` is what a gap sampler reports — it cannot service a posted
 * task until the run ends. `maxTaskMs` is what a gap sampler cannot report,
 * and the two together say which fault produced the stall.
 */
export type RendererBusyRun = {
  startMs: number
  busyRunMs: number
  taskCount: number
  maxTaskMs: number
  /** `maxTaskMs / busyRunMs`: 1 means one task did all of it. */
  longestTaskFraction: number
  shape: 'contiguous' | 'saturated-queue' | 'empty'
}

export type RendererTaskTraceHandle = {
  session: CDPSession
  anchorPerfNowMs: number
  events: TraceEvent[]
  complete: Promise<void>
}

type TraceEvent = {
  name?: string
  ph?: string
  ts?: number
  dur?: number
  pid?: number
  tid?: number
  args?: { data?: Record<string, unknown> }
}

const ANCHOR_MARK = 'orca-task-trace-anchor'
/**
 * `devtools.timeline` carries the JS-level events (ORCA-239). Without it a
 * 900ms page task of pure JS reports no child at all — measured, not assumed —
 * so an empty frame list read as "nothing instrumented ran here".
 */
export const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing'
]
/**
 * The set ORCA-230 measured with. Kept so the category addition above can be
 * A/B'd against the phenomenon that PR established, rather than assumed
 * harmless: recording more events is not free, and the ghost it reproduces is
 * a compositor wait.
 */
export const PRE_ORCA_239_TRACE_CATEGORIES = [
  'disabled-by-default-devtools.timeline',
  'blink.user_timing'
]
/** Two tasks closer than this never let a posted task through between them. */
const IDLE_GAP_MS = 1
const CONTIGUOUS_FRACTION = 0.8
const MIN_FRAME_MS = 1
/** Trace timestamps are whole microseconds; a child filling its parent rounds past it. */
const CONTAINMENT_SLACK_US = 1_000

/**
 * Every main-thread task and its duration, from the renderer's own trace.
 *
 * Why not `PerformanceObserver('longtask')` (ORCA-230): measured here, a 900ms
 * block injected through `page.evaluate` produces no `longtask` entry at all —
 * the inspector's task is not on an instrumented queue — while the same block
 * posted as a page task produces one. The freeze oracles drive bulk-open
 * through `page.evaluate`, so `longtask` would report an empty list for the
 * very block under investigation, and that emptiness reads as "no long task".
 * `RunTask` has neither that gap nor the 50ms floor.
 *
 * Why it cannot share a window with the block sampler: that sampler services
 * 60-80k tasks per second, and the trace records one event per task.
 *
 * The anchor is what makes the result usable: trace timestamps are on their own
 * clock, so a mark emitted from the page pins them to `performance.now()`, and
 * its thread pins the task list to this renderer rather than to every process
 * the trace happened to cover.
 */
export async function startRendererTaskTrace(
  page: Page,
  options: { categories?: string[] } = {}
): Promise<RendererTaskTraceHandle> {
  const session = await page.context().newCDPSession(page)
  const events: TraceEvent[] = []
  session.on('Tracing.dataCollected', (payload) => {
    events.push(...(payload.value as TraceEvent[]))
  })
  const complete = new Promise<void>((resolve) => {
    session.once('Tracing.tracingComplete', () => resolve())
  })
  await session.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: options.categories ?? TRACE_CATEGORIES }
  })
  const anchorPerfNowMs = await page.evaluate((mark) => {
    performance.mark(mark)
    return performance.now()
  }, ANCHOR_MARK)
  return { session, anchorPerfNowMs, events, complete }
}

export async function stopRendererTaskTrace(
  handle: RendererTaskTraceHandle
): Promise<RendererTaskTraceWindow> {
  const notes: string[] = []
  try {
    await handle.session.send('Tracing.end')
    await handle.complete
  } finally {
    await handle.session.detach().catch(() => undefined)
  }
  const anchor = handle.events.find((event) => event.name === ANCHOR_MARK && event.ts !== undefined)
  if (!anchor?.ts) {
    notes.push('task trace found no anchor mark — task list unreadable')
    return { anchored: false, tasks: [], eventCount: handle.events.length, notes }
  }
  const offsetMs = anchor.ts / 1000 - handle.anchorPerfNowMs
  const tasks = handle.events
    .filter(
      (event) =>
        event.pid === anchor.pid &&
        event.tid === anchor.tid &&
        event.name === 'RunTask' &&
        event.ts !== undefined &&
        event.dur !== undefined
    )
    .map((event) => ({
      startMs: (event.ts ?? 0) / 1000 - offsetMs,
      durationMs: (event.dur ?? 0) / 1000
    }))
    .sort((a, b) => a.startMs - b.startMs)
  return { anchored: true, tasks, eventCount: handle.events.length, notes }
}

/** Longest stretch with no idle gap inside the window, and what filled it. */
export function worstBusyRun(
  trace: RendererTaskTraceWindow,
  fromMs = -Infinity,
  toMs = Infinity
): RendererBusyRun {
  const tasks = trace.tasks.filter(
    (task) => task.startMs < toMs && task.startMs + task.durationMs > fromMs
  )
  let worst: RendererBusyRun = {
    startMs: 0,
    busyRunMs: 0,
    taskCount: 0,
    maxTaskMs: 0,
    longestTaskFraction: 0,
    shape: 'empty'
  }
  let runStart: number | null = null
  let runEnd = 0
  let runTasks = 0
  let runMaxTask = 0
  const closeRun = (): void => {
    if (runStart === null) {
      return
    }
    const busyRunMs = runEnd - runStart
    if (busyRunMs > worst.busyRunMs) {
      worst = {
        startMs: runStart,
        busyRunMs,
        taskCount: runTasks,
        maxTaskMs: runMaxTask,
        longestTaskFraction: busyRunMs > 0 ? runMaxTask / busyRunMs : 0,
        shape: runMaxTask / busyRunMs >= CONTIGUOUS_FRACTION ? 'contiguous' : 'saturated-queue'
      }
    }
  }
  for (const task of tasks) {
    if (runStart !== null && task.startMs - runEnd > IDLE_GAP_MS) {
      closeRun()
      runStart = null
    }
    if (runStart === null) {
      runStart = task.startMs
      runEnd = task.startMs
      runTasks = 0
      runMaxTask = 0
    }
    runEnd = Math.max(runEnd, task.startMs + task.durationMs)
    runTasks += 1
    runMaxTask = Math.max(runMaxTask, task.durationMs)
  }
  closeRun()
  return worst
}

/**
 * Trace timestamps minus `performance.now()`, from the anchor mark. Null when
 * the trace never saw the mark. Other instruments on the same renderer share
 * this clock, so they can borrow the conversion instead of deriving their own.
 */
export function traceClockOffsetMs(handle: RendererTaskTraceHandle): number | null {
  const anchor = handle.events.find((event) => event.name === ANCHOR_MARK && event.ts !== undefined)
  return anchor?.ts === undefined ? null : anchor.ts / 1000 - handle.anchorPerfNowMs
}

/** Largest trace events nested inside a task: what the task was doing. */
export function framesInsideTask(
  handle: RendererTaskTraceHandle,
  task: RendererTracedTask,
  limit = 8
): RendererTracedFrame[] {
  const anchor = handle.events.find((event) => event.name === ANCHOR_MARK && event.ts !== undefined)
  if (!anchor?.ts) {
    return []
  }
  const offsetMs = anchor.ts / 1000 - handle.anchorPerfNowMs
  const startUs = (task.startMs + offsetMs) * 1000
  const endUs = (task.startMs + task.durationMs + offsetMs) * 1000
  // Containment with a microsecond of slack: a child that fills its parent is
  // the interesting case, and it must not lose to quantization. Not overlap —
  // an event that encloses the task would clip to the task's own length and
  // outrank every real child.
  return handle.events
    .filter(
      (event) =>
        event.pid === anchor.pid &&
        event.tid === anchor.tid &&
        event.name !== 'RunTask' &&
        event.ts !== undefined &&
        event.dur !== undefined &&
        event.ts >= startUs - CONTAINMENT_SLACK_US &&
        event.ts + event.dur <= endUs + CONTAINMENT_SLACK_US &&
        event.dur / 1000 >= MIN_FRAME_MS
    )
    .map((event) => ({
      name: event.name ?? 'unknown',
      durationMs: (event.dur ?? 0) / 1000,
      source: callFrameSource(event)
    }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit)
}

function overlapMs(
  startUs: number,
  endUs: number,
  windowStartUs: number,
  windowEndUs: number
): number {
  return Math.max(0, Math.min(endUs, windowEndUs) - Math.max(startUs, windowStartUs)) / 1000
}

/**
 * Every traced event overlapping a task, by name — including the sub-millisecond
 * ones `framesInsideTask` drops. An empty census and a census of a thousand
 * 0.1ms events are different faults, and a frame list shows neither.
 */
export function taskEventCensus(
  handle: RendererTaskTraceHandle,
  task: RendererTracedTask
): { name: string; count: number; totalMs: number }[] {
  const anchor = handle.events.find((event) => event.name === ANCHOR_MARK && event.ts !== undefined)
  if (!anchor?.ts) {
    return []
  }
  const offsetMs = anchor.ts / 1000 - handle.anchorPerfNowMs
  const startUs = (task.startMs + offsetMs) * 1000
  const endUs = (task.startMs + task.durationMs + offsetMs) * 1000
  const byName = new Map<string, { name: string; count: number; totalMs: number }>()
  for (const event of handle.events) {
    if (event.pid !== anchor.pid || event.tid !== anchor.tid || event.name === 'RunTask') {
      continue
    }
    if (event.ts === undefined) {
      continue
    }
    const eventEndUs = event.ts + (event.dur ?? 0)
    if (eventEndUs < startUs || event.ts > endUs) {
      continue
    }
    const name = event.name ?? 'unknown'
    const entry = byName.get(name) ?? { name, count: 0, totalMs: 0 }
    entry.count += 1
    entry.totalMs += overlapMs(event.ts, eventEndUs, startUs, endUs)
    byName.set(name, entry)
  }
  return [...byName.values()]
    .map((entry) => ({ ...entry, totalMs: Number(entry.totalMs.toFixed(1)) }))
    .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count)
}

function callFrameSource(event: TraceEvent): string | null {
  const data = event.args?.data
  if (!data) {
    return null
  }
  const url = typeof data.url === 'string' ? data.url : null
  const functionName = typeof data.functionName === 'string' ? data.functionName : null
  const line = typeof data.lineNumber === 'number' ? data.lineNumber : null
  if (!url && !functionName) {
    return null
  }
  const location = url ? `${url.split('/').pop() ?? url}${line === null ? '' : `:${line}`}` : ''
  return [functionName, location].filter(Boolean).join(' ') || null
}

export function formatBusyRun(run: RendererBusyRun, label: string): string {
  return (
    `${label} busyRun=${run.busyRunMs.toFixed(1)}ms at +${run.startMs.toFixed(0)}ms ` +
    `tasks=${run.taskCount} maxTask=${run.maxTaskMs.toFixed(1)}ms ` +
    `longestFraction=${(run.longestTaskFraction * 100).toFixed(0)}% shape=${run.shape}`
  )
}
