/**
 * Why this exists: `Execution context was destroyed` does not say which frame's
 * context died, or whether the frame was detached. The CDP events that do say so
 * are the only record that names the exact moment, so this captures them for the
 * whole test and attaches them whether the test passed or not.
 *
 * Listener-only apart from the Page/Runtime enables the events need. Pure mapping
 * lives in `applyCdpLifecycleEvent`, so the classification is testable without a browser.
 */
import type { CDPSession, Page, TestInfo } from '@stablyai/playwright-test'

/**
 * `contexts-cleared` is what a main-document reload or navigation emits, not
 * per-context destruction, and it names no frame.
 */
export type LifecycleKind = 'context-destroyed' | 'contexts-cleared' | 'frame-detached'

export type LifecycleRecord = {
  /** ms since the recorder attached. */
  atMs: number
  /** Wall-clock time, to line up with the job log. */
  at: string
  kind: LifecycleKind
  frameId: string | null
  isMainFrame: boolean
  contextId: number | null
  /** `default` is the page's own world; `isolated` is Playwright's utility world. */
  contextType: string | null
  /** `Page.frameDetached` only: 'remove' or 'swap'. The protocol gives no reason for context destruction. */
  reason: string | null
}

type ContextInfo = { frameId: string | null; type: string | null }

export type LifecycleState = {
  mainFrameId: string | null
  contexts: Map<number, ContextInfo>
}

type LifecycleMeta = { atMs: number; at: string }

type LifecycleFields = Omit<LifecycleRecord, 'atMs' | 'at' | 'isMainFrame'>

const LIFECYCLE_METHODS = [
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared',
  'Page.frameDetached'
] as const

export function createLifecycleState(mainFrameId: string | null): LifecycleState {
  return { mainFrameId, contexts: new Map() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function toRecord(
  state: LifecycleState,
  meta: LifecycleMeta,
  fields: LifecycleFields
): LifecycleRecord {
  return {
    ...meta,
    ...fields,
    isMainFrame: fields.frameId !== null && fields.frameId === state.mainFrameId
  }
}

/**
 * Applies one CDP event to the lifecycle state and returns the record it produces.
 * Context creation only feeds the context-to-frame map; it returns no record, since
 * every frame creates contexts and listing them would bury the destructions.
 */
export function applyCdpLifecycleEvent(
  state: LifecycleState,
  method: string,
  params: unknown,
  meta: LifecycleMeta
): LifecycleRecord | null {
  if (method === 'Runtime.executionContextCreated') {
    const context = isRecord(params) && isRecord(params.context) ? params.context : null
    const contextId = readNumber(context?.id)
    if (!context || contextId === null) {
      return null
    }
    const auxData = isRecord(context.auxData) ? context.auxData : {}
    state.contexts.set(contextId, {
      frameId: readString(auxData.frameId),
      type: readString(auxData.type)
    })
    return null
  }
  if (method === 'Runtime.executionContextDestroyed') {
    const contextId = isRecord(params) ? readNumber(params.executionContextId) : null
    if (contextId === null) {
      return null
    }
    // A context created before recording began has no entry: it is kept, with no frame.
    const info = state.contexts.get(contextId) ?? { frameId: null, type: null }
    state.contexts.delete(contextId)
    return toRecord(state, meta, {
      kind: 'context-destroyed',
      frameId: info.frameId,
      contextId,
      contextType: info.type,
      reason: null
    })
  }
  if (method === 'Runtime.executionContextsCleared') {
    state.contexts.clear()
    return toRecord(state, meta, {
      kind: 'contexts-cleared',
      frameId: null,
      contextId: null,
      contextType: null,
      reason: null
    })
  }
  if (method === 'Page.frameDetached') {
    const frameId = isRecord(params) ? readString(params.frameId) : null
    if (frameId === null) {
      return null
    }
    return toRecord(state, meta, {
      kind: 'frame-detached',
      frameId,
      contextId: null,
      contextType: null,
      reason: isRecord(params) ? readString(params.reason) : null
    })
  }
  return null
}

/** One log line naming the counts and the last event, in the shape the other evidence helpers print. */
export function formatContextLifecycleLine(
  testTitle: string,
  records: readonly LifecycleRecord[]
): string {
  const head = `[context-lifecycle] ${testTitle} :: `
  const last = records.at(-1)
  if (!last) {
    return `${head}no events`
  }
  const counts = new Map<LifecycleKind, number>()
  for (const record of records) {
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1)
  }
  const kinds = [...counts].map(([kind, count]) => `${kind}=${count}`).join(', ')
  return (
    `${head}${records.length} events (${kinds}), last: ${last.kind} ` +
    `frame=${last.frameId ?? 'none'} main=${last.isMainFrame} reason=${last.reason ?? 'none'} ` +
    `at ${last.atMs}ms`
  )
}

function readMainFrameId(frameTree: unknown): string | null {
  if (!isRecord(frameTree) || !isRecord(frameTree.frameTree)) {
    return null
  }
  const frame = frameTree.frameTree.frame
  return isRecord(frame) ? readString(frame.id) : null
}

export type ContextLifecycleRecorder = {
  /** Detaches the CDP session and returns every record captured so far. */
  stop: () => Promise<LifecycleRecord[]>
}

/**
 * Starts recording the page's context and frame lifecycle over CDP.
 *
 * Enables Page before Runtime so the main frame id is known before Runtime
 * replays the existing contexts; that replay is what maps them to frames.
 */
export async function startContextLifecycleRecording(
  page: Page
): Promise<ContextLifecycleRecorder> {
  const session: CDPSession = await page.context().newCDPSession(page)
  const startedAt = Date.now()
  const records: LifecycleRecord[] = []
  const state = createLifecycleState(null)

  for (const method of LIFECYCLE_METHODS) {
    session.on(method, (params: unknown) => {
      const now = Date.now()
      const record = applyCdpLifecycleEvent(state, method, params, {
        atMs: now - startedAt,
        at: new Date(now).toISOString()
      })
      if (record) {
        records.push(record)
      }
    })
  }

  await session.send('Page.enable')
  state.mainFrameId = readMainFrameId(await session.send('Page.getFrameTree'))
  await session.send('Runtime.enable')

  return {
    stop: async () => {
      // A renderer that died or a closed window can reject detach; the records stand either way.
      await session.detach().catch(() => undefined)
      return [...records]
    }
  }
}

/**
 * Attaches the captured lifecycle to the test on every outcome, pass or fail.
 *
 * Unlike the failure-only evidence helpers, this is attached on green too: the
 * point is a record of what happened in a run that may not yet have failed.
 */
export async function reportContextLifecycle(
  recorder: ContextLifecycleRecorder,
  testInfo: TestInfo
): Promise<void> {
  const records = await recorder.stop()
  console.log(formatContextLifecycleLine(testInfo.titlePath.join(' > '), records))
  await testInfo.attach('context-lifecycle.json', {
    body: JSON.stringify({ records }, null, 2),
    contentType: 'application/json'
  })
}
