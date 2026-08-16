import type { CDPSession, Page } from '@stablyai/playwright-test'

/**
 * Where a task's milliseconds went, by V8 stack sample (ORCA-239).
 *
 * The task trace says how long a task ran and which Blink phases it entered; it
 * does not say which function burned the time, and for the case that matters it
 * cannot — work driven through the inspector emits no `FunctionCall` at all,
 * measured in renderer-cpu-profile-calibration.spec.ts. Every task in R1's
 * bulk-open storm is inspector-driven.
 *
 * Timestamps come from the task trace's anchor mark rather than from a second
 * anchor of this instrument's own: a named spin is the obvious way to place the
 * profile on `performance.now()`, and it does not survive — TurboFan inlines it
 * after the first arm warms it up and its node stops existing. What proves the
 * shared clock instead is the calibration's positive control: a burn of known
 * size in a function of known name has to come back against the window the
 * trace independently reports for that task.
 *
 * The E2E renderer bundle is not minified, so `functionName` is the source name
 * and no source map is needed to read the result.
 */
export type RendererProfileFrame = {
  functionName: string
  /** Bundle position — the build is unminified, so the name is the source name. */
  location: string | null
  selfMs: number
  sampleCount: number
  /** Callers, nearest first. */
  callers: string[]
}

export type RendererProfileWindow = {
  /** False when no sample fell in the window — nothing below is attributable. */
  attributed: boolean
  windowFromMs: number
  windowToMs: number
  sampleCount: number
  frames: RendererProfileFrame[]
  notes: string[]
}

export type RendererCpuProfileHandle = {
  session: CDPSession
  profile: CdpProfile | null
}

type CdpCallFrame = {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}

type CdpProfileNode = {
  id: number
  callFrame: CdpCallFrame
  children?: number[]
}

type CdpProfile = {
  nodes: CdpProfileNode[]
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

/** 250us over a 200ms task is ~800 samples — enough to rank, cheap enough not to distort. */
const SAMPLE_INTERVAL_US = 250
/**
 * `Profiler.start` returns before the sampler is actually taking samples.
 * Measured (ORCA-239): a 400ms block injected immediately after it came back
 * with ONE sample carrying a 477.7ms delta — the profile looked valid and
 * attributed nothing. Work measured inside this window is not sampled.
 */
const SAMPLER_WARMUP_MS = 500
/** Below this share of the samples a window is owed, the sampler was not really on. */
const MIN_SAMPLE_DENSITY = 0.5

export async function startRendererCpuProfile(page: Page): Promise<RendererCpuProfileHandle> {
  const session = await page.context().newCDPSession(page)
  await session.send('Profiler.enable')
  await session.send('Profiler.setSamplingInterval', { interval: SAMPLE_INTERVAL_US })
  await session.send('Profiler.start')
  await page.waitForTimeout(SAMPLER_WARMUP_MS)
  return { session, profile: null }
}

/** Samples a live sampler owes a window of this length. */
export function expectedSampleCount(windowMs: number): number {
  return (windowMs * 1000) / SAMPLE_INTERVAL_US
}

export async function stopRendererCpuProfile(
  handle: RendererCpuProfileHandle
): Promise<RendererCpuProfileHandle> {
  try {
    const result = (await handle.session.send('Profiler.stop')) as { profile: CdpProfile }
    handle.profile = result.profile
  } finally {
    await handle.session.send('Profiler.disable').catch(() => undefined)
    await handle.session.detach().catch(() => undefined)
  }
  return handle
}

/**
 * Self time by call frame between two `performance.now()` marks.
 *
 * `clockOffsetMs` is `traceClockOffsetMs` from the task trace that ran over the
 * same window.
 */
export function profileWindow(
  handle: RendererCpuProfileHandle,
  clockOffsetMs: number | null,
  fromMs: number,
  toMs: number,
  limit = 12
): RendererProfileWindow {
  const notes: string[] = []
  const profile = handle.profile
  const empty: RendererProfileWindow = {
    attributed: false,
    windowFromMs: fromMs,
    windowToMs: toMs,
    sampleCount: 0,
    frames: [],
    notes
  }
  if (!profile) {
    notes.push('cpu profile never stopped — no samples')
    return empty
  }
  if (clockOffsetMs === null) {
    notes.push('task trace found no anchor mark — the profile cannot be placed')
    return empty
  }
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const parentOf = new Map<number, number>()
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parentOf.set(child, node.id)
    }
  }
  const selfUs = new Map<number, { us: number; samples: number }>()
  let ticksUs = profile.startTime
  let sampleCount = 0
  for (let i = 0; i < profile.samples.length; i += 1) {
    const deltaUs = profile.timeDeltas[i] ?? 0
    ticksUs += deltaUs
    const atMs = ticksUs / 1000 - clockOffsetMs
    if (atMs < fromMs || atMs > toMs) {
      continue
    }
    sampleCount += 1
    const id = profile.samples[i]
    const entry = selfUs.get(id) ?? { us: 0, samples: 0 }
    entry.us += deltaUs
    entry.samples += 1
    selfUs.set(id, entry)
  }
  if (sampleCount === 0) {
    notes.push(
      `no sample fell in [${fromMs.toFixed(0)}, ${toMs.toFixed(0)}]ms of ` +
        `${profile.samples.length} taken`
    )
    return empty
  }
  const owed = expectedSampleCount(toMs - fromMs)
  if (owed > 0 && sampleCount < owed * MIN_SAMPLE_DENSITY) {
    notes.push(
      `sampler covered ${sampleCount} of ~${owed.toFixed(0)} samples this window owes — ` +
        `attribution below is not the whole window`
    )
  }
  const frames = [...selfUs.entries()]
    .map(([id, entry]) => {
      const node = byId.get(id)
      return {
        functionName: node?.callFrame.functionName || '(anonymous)',
        location: formatLocation(node?.callFrame),
        selfMs: Number((entry.us / 1000).toFixed(1)),
        sampleCount: entry.samples,
        callers: callerChain(id, parentOf, byId)
      }
    })
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, limit)
  return { attributed: true, windowFromMs: fromMs, windowToMs: toMs, sampleCount, frames, notes }
}

/**
 * Self time summed over every frame whose stack passes through `functionName`.
 *
 * A leaf-only ranking under-reports a function that spends its time in
 * builtins, and TurboFan can inline a small callee out of the tree entirely, so
 * a positive control has to ask about the subtree rather than the leaf.
 */
export function selfTimeUnder(window: RendererProfileWindow, functionName: string): number {
  return window.frames
    .filter(
      (frame) =>
        frame.functionName === functionName ||
        frame.callers.some((caller) => caller.split(' ')[0] === functionName)
    )
    .reduce((total, frame) => total + frame.selfMs, 0)
}

function callerChain(
  id: number,
  parentOf: Map<number, number>,
  byId: Map<number, CdpProfileNode>,
  depth = 8
): string[] {
  const chain: string[] = []
  let current = parentOf.get(id)
  while (current !== undefined && chain.length < depth) {
    const node = byId.get(current)
    const name = node?.callFrame.functionName || '(anonymous)'
    const location = formatLocation(node?.callFrame)
    chain.push(location ? `${name} ${location}` : name)
    current = parentOf.get(current)
  }
  return chain
}

function formatLocation(callFrame: CdpCallFrame | undefined): string | null {
  if (!callFrame?.url) {
    return null
  }
  const file = callFrame.url.split('/').pop() ?? callFrame.url
  return `${file}:${callFrame.lineNumber + 1}:${callFrame.columnNumber + 1}`
}
