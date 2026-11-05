import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelPendingPaneSizeRefreshFrames, createExpandCollapseActions } from './expand-collapse'

type ExpandCollapseStateForTest = Parameters<typeof createExpandCollapseActions>[0]

function ref<T>(current: T): React.MutableRefObject<T> {
  return { current }
}

function createState(
  overrides: Partial<ExpandCollapseStateForTest> = {}
): ExpandCollapseStateForTest {
  return {
    expandedPaneIdRef: ref(null),
    expandedStyleSnapshotRef: ref(new Map()),
    containerRef: ref(null),
    managerRef: ref(null),
    pendingPaneSizeRefreshFrameIdsRef: ref([]),
    setExpandedPaneId: vi.fn(),
    setTabPaneExpanded: vi.fn(),
    tabId: 'tab-1',
    persistLayoutSnapshot: vi.fn(),
    ...overrides
  }
}

describe('createExpandCollapseActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancels pending pane-size refresh frames', () => {
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42)
    )
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    const state = createState()

    createExpandCollapseActions(state).refreshPaneSizes(true)

    expect(state.pendingPaneSizeRefreshFrameIdsRef.current).toEqual([42])

    cancelPendingPaneSizeRefreshFrames(state)

    expect(cancelAnimationFrame).toHaveBeenCalledWith(42)
    expect(state.pendingPaneSizeRefreshFrameIdsRef.current).toEqual([])
  })

  it('forgets completed pane-size refresh frames', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((next: FrameRequestCallback) => {
        callbacks.push(next)
        return 7
      })
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const state = createState({
      managerRef: ref({
        getPanes: () => [],
        getActivePane: () => null
      } as never)
    })

    createExpandCollapseActions(state).refreshPaneSizes(false)

    expect(state.pendingPaneSizeRefreshFrameIdsRef.current).toEqual([7])

    const callback = callbacks[0]
    if (!callback) {
      throw new Error('expected pane-size refresh frame to be scheduled')
    }
    callback(16)

    expect(state.pendingPaneSizeRefreshFrameIdsRef.current).toEqual([])
  })

  describe('collapse refresh frame focus', () => {
    class FakeHTMLElement {
      readonly isContentEditable = false
      readonly classList: { contains: (className: string) => boolean }
      constructor(
        readonly tagName: string,
        classNames: string[] = []
      ) {
        this.classList = { contains: (className) => classNames.includes(className) }
      }
      closest(): Element | null {
        return null
      }
    }

    function runRefreshFrameWithActiveElement(activeElement: FakeHTMLElement): () => void {
      vi.stubGlobal('HTMLElement', FakeHTMLElement)
      vi.stubGlobal('document', { activeElement, querySelector: () => null })
      const callbacks: FrameRequestCallback[] = []
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((next: FrameRequestCallback) => callbacks.push(next))
      )
      const terminal = { focus: vi.fn() }
      const pane = { terminal }
      const state = createState({
        managerRef: ref({ getPanes: () => [pane], getActivePane: () => pane } as never)
      })
      createExpandCollapseActions(state).refreshPaneSizes(true)
      callbacks[0]?.(16)
      return terminal.focus
    }

    it('does not take focus from the search input opened before the frame ran', () => {
      expect(runRefreshFrameWithActiveElement(new FakeHTMLElement('INPUT'))).not.toHaveBeenCalled()
    })

    it('still refocuses the terminal when no editable field owns focus', () => {
      const helper = new FakeHTMLElement('TEXTAREA', ['xterm-helper-textarea'])
      expect(runRefreshFrameWithActiveElement(helper)).toHaveBeenCalledTimes(1)
    })
  })

  it('does not retain synchronously completed pane-size refresh frames', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(16)
        return 9
      })
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const state = createState()

    createExpandCollapseActions(state).refreshPaneSizes(false)

    expect(state.pendingPaneSizeRefreshFrameIdsRef.current).toEqual([])
  })
})
