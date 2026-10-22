import { describe, expect, it } from 'vitest'
import {
  applyCdpLifecycleEvent,
  createLifecycleState,
  formatContextLifecycleLine,
  markLifecycle,
  type LifecycleRecord
} from './execution-context-lifecycle'

const MAIN = 'MAIN_FRAME'
const PANEL = 'PANEL_FRAME'
const AT = { atMs: 1200, at: '2026-10-19T12:00:01.200Z' }

function created(contextId: number, frameId: string, type: string): unknown {
  return { context: { id: contextId, auxData: { frameId, type, isDefault: type === 'default' } } }
}

describe('applyCdpLifecycleEvent', () => {
  it('names the frame and world a destroyed context belonged to', () => {
    const lifecycle = createLifecycleState(MAIN)
    applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextCreated',
      created(7, PANEL, 'default'),
      AT
    )
    const record = applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextDestroyed',
      { executionContextId: 7 },
      AT
    )
    expect(record).toEqual({
      ...AT,
      kind: 'context-destroyed',
      frameId: PANEL,
      isMainFrame: false,
      contextId: 7,
      contextType: 'default',
      reason: null
    })
  })

  it('flags a destroyed context that belonged to the main frame', () => {
    const lifecycle = createLifecycleState(MAIN)
    applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextCreated',
      created(3, MAIN, 'default'),
      AT
    )
    const record = applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextDestroyed',
      { executionContextId: 3 },
      AT
    )
    expect(record).toMatchObject({ frameId: MAIN, isMainFrame: true })
  })

  it('keeps a destroyed context with no frame when it was created before recording began', () => {
    const record = applyCdpLifecycleEvent(
      createLifecycleState(MAIN),
      'Runtime.executionContextDestroyed',
      { executionContextId: 99 },
      AT
    )
    expect(record).toMatchObject({ kind: 'context-destroyed', contextId: 99, frameId: null })
  })

  it('records a frame detach with the reason the protocol gives', () => {
    const record = applyCdpLifecycleEvent(
      createLifecycleState(MAIN),
      'Page.frameDetached',
      { frameId: PANEL, reason: 'remove' },
      AT
    )
    expect(record).toEqual({
      ...AT,
      kind: 'frame-detached',
      frameId: PANEL,
      isMainFrame: false,
      contextId: null,
      contextType: null,
      reason: 'remove'
    })
  })

  it('marks a swap of the main frame as the main frame', () => {
    const record = applyCdpLifecycleEvent(
      createLifecycleState(MAIN),
      'Page.frameDetached',
      { frameId: MAIN, reason: 'swap' },
      AT
    )
    expect(record).toMatchObject({ isMainFrame: true, reason: 'swap' })
  })

  it('records a contexts-cleared event with no frame and forgets the mapped contexts', () => {
    const lifecycle = createLifecycleState(MAIN)
    applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextCreated',
      created(5, MAIN, 'default'),
      AT
    )
    const record = applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextsCleared',
      undefined,
      AT
    )
    expect(record).toMatchObject({ kind: 'contexts-cleared', frameId: null, isMainFrame: false })
    const afterClear = applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextDestroyed',
      { executionContextId: 5 },
      AT
    )
    expect(afterClear).toMatchObject({ frameId: null, contextType: null })
  })

  it('returns no record for a context creation, which only feeds the frame map', () => {
    expect(
      applyCdpLifecycleEvent(
        createLifecycleState(MAIN),
        'Runtime.executionContextCreated',
        created(1, PANEL, 'isolated'),
        AT
      )
    ).toBeNull()
  })

  it('returns no record for malformed params or an unrelated method', () => {
    const lifecycle = createLifecycleState(MAIN)
    expect(
      applyCdpLifecycleEvent(lifecycle, 'Page.frameDetached', { reason: 'remove' }, AT)
    ).toBeNull()
    expect(
      applyCdpLifecycleEvent(lifecycle, 'Runtime.executionContextDestroyed', 'junk', AT)
    ).toBeNull()
    expect(applyCdpLifecycleEvent(lifecycle, 'Page.frameNavigated', { frame: {} }, AT)).toBeNull()
  })
})

describe('formatContextLifecycleLine', () => {
  it('says so when nothing was recorded', () => {
    expect(formatContextLifecycleLine('spec > test', [])).toBe(
      '[context-lifecycle] spec > test :: no events'
    )
  })

  it('counts each kind and names the last event with its frame, main-frame flag and reason', () => {
    const records: LifecycleRecord[] = [
      {
        ...AT,
        kind: 'context-destroyed',
        frameId: PANEL,
        isMainFrame: false,
        contextId: 2,
        contextType: 'default',
        reason: null
      },
      {
        atMs: 1500,
        at: '2026-10-19T12:00:01.500Z',
        kind: 'frame-detached',
        frameId: MAIN,
        isMainFrame: true,
        contextId: null,
        contextType: null,
        reason: 'swap'
      }
    ]
    expect(formatContextLifecycleLine('spec > test', records)).toBe(
      '[context-lifecycle] spec > test :: 2 events (context-destroyed=1, frame-detached=1), ' +
        'last: frame-detached frame=MAIN_FRAME main=true reason=swap at 1500ms'
    )
  })
})

// ORCA-753: setTheme lost its context with no main-frame destroy on record, so the
// main frame's context is now tracked by id and each call site can be marked.
describe('main-frame context tracking', () => {
  it('records a main-frame default-world creation, which a silent replacement would show as', () => {
    const lifecycle = createLifecycleState(MAIN)
    expect(
      applyCdpLifecycleEvent(
        lifecycle,
        'Runtime.executionContextCreated',
        created(9, MAIN, 'default'),
        AT
      )
    ).toEqual({
      ...AT,
      kind: 'main-context-created',
      frameId: MAIN,
      isMainFrame: true,
      contextId: 9,
      contextType: 'default',
      reason: null
    })
  })

  it('keeps a main-frame isolated world out of the records', () => {
    expect(
      applyCdpLifecycleEvent(
        createLifecycleState(MAIN),
        'Runtime.executionContextCreated',
        created(10, MAIN, 'isolated'),
        AT
      )
    ).toBeNull()
  })

  it('marks a call site with the main frame context that is live at that moment', () => {
    const lifecycle = createLifecycleState(MAIN)
    applyCdpLifecycleEvent(
      lifecycle,
      'Runtime.executionContextCreated',
      created(3, MAIN, 'default'),
      AT
    )
    expect(markLifecycle(lifecycle, AT, 'setTheme dark frame=390')).toEqual({
      ...AT,
      kind: 'mark',
      frameId: MAIN,
      isMainFrame: true,
      contextId: 3,
      contextType: 'default',
      reason: 'setTheme dark frame=390'
    })
  })

  it('marks with no context when the main frame has none on record', () => {
    expect(markLifecycle(createLifecycleState(MAIN), AT, 'setTheme light')).toMatchObject({
      kind: 'mark',
      contextId: null
    })
  })

  it('names the last mark apart from the last event, so a mark never hides the event before it', () => {
    const records: LifecycleRecord[] = [
      {
        ...AT,
        kind: 'frame-detached',
        frameId: PANEL,
        isMainFrame: false,
        contextId: null,
        contextType: null,
        reason: 'swap'
      },
      {
        ...AT,
        kind: 'mark',
        frameId: MAIN,
        isMainFrame: true,
        contextId: 3,
        contextType: 'default',
        reason: 'setTheme dark frame=390'
      }
    ]
    expect(formatContextLifecycleLine('spec > test', records)).toBe(
      '[context-lifecycle] spec > test :: 2 events (frame-detached=1, mark=1), ' +
        'last: frame-detached frame=PANEL_FRAME main=false reason=swap at 1200ms, ' +
        'last mark: setTheme dark frame=390 ctx=3 at 1200ms'
    )
  })
})
