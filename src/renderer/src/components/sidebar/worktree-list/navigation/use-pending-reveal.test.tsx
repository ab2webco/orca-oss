// @vitest-environment happy-dom
// ORCA-1192: a sidebar reveal scrolls the row into view without moving focus, and a passive one
// gives up on a row it cannot render instead of landing later.
import { act, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Virtualizer } from '@tanstack/react-virtual'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import { makeWorktree } from '@/store/slices/store-test-helpers'
import { VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT } from '@/hooks/useVirtualizedScrollAnchor'
import type { RenderRow } from '../listing/render-row'
import { getWorktreeOptionId } from '../rows/option-dom'
import { MAX_REVEAL_RETRIES, type PendingSidebarRevealArgs } from './pending-reveal-inputs'
import { REVEAL_HOLD_QUIET_MS } from './reveal-hold'
import { usePendingSidebarReveal } from './use-pending-reveal'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { setRenamingWorktreeId: () => void }) => unknown) =>
    selector({ setRenamingWorktreeId: vi.fn() })
}))

const worktree = makeWorktree({ id: 'wt-target', repoId: 'repo-1' })
const targetRow: RenderRow = {
  type: 'item',
  rowKey: 'wt-target',
  sectionKey: 'repo:repo-1',
  worktree,
  repo: undefined,
  depth: 0,
  groupDepth: 0,
  lineageTrail: [],
  isLastLineageChild: false,
  lineageChildCount: 0
}

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  frames = []
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  document.body.innerHTML = ''
})

function Probe({ args }: { args: PendingSidebarRevealArgs }): null {
  usePendingSidebarReveal(args)
  return null
}

function makeArgs(
  pending: PendingSidebarWorktreeReveal,
  renderRows: RenderRow[],
  scrollRef: RefObject<HTMLDivElement | null>
): PendingSidebarRevealArgs & {
  clearPendingRevealWorktreeId: Mock<() => void>
  markRevealScroll: Mock<(targetTop: number) => void>
} {
  const virtualizer = { scrollToIndex: vi.fn() } as unknown as Virtualizer<
    HTMLDivElement,
    HTMLDivElement
  >
  return {
    pendingRevealWorktree: pending,
    pendingRevealSidebarRow: null,
    clearPendingRevealWorktreeId: vi.fn<() => void>(),
    clearPendingRevealSidebarRow: vi.fn(),
    agentSendTargetWorktreeId: null,
    renderRows,
    virtualizer,
    scrollRef,
    worktrees: [worktree],
    folderWorkspaces: [],
    repoMap: new Map(),
    worktreeMap: new Map([[worktree.id, worktree]]),
    worktreeLineageById: {},
    collapsedGroups: new Set(),
    toggleGroup: vi.fn(),
    groupBy: 'repo',
    pinnedDisplayPolicy: 'single-location',
    defaultHostId: 'local',
    prCache: null,
    agentStatusByWorktree: new Map(),
    settings: null,
    projectGroups: [],
    flashRevealedRow: vi.fn(),
    markRevealScroll: vi.fn<(targetTop: number) => void>(),
    hasDirectScrollInput: () => false,
    schedulePendingRevealFrame: (callback) => {
      frames.push(callback)
    },
    cancelPendingRevealFrames: () => {
      frames.length = 0
    }
  }
}

let frames: FrameRequestCallback[] = []
let now = 0

/** Runs the queued reveal frames `count` times, `gapMs` apart (a painting window is 16ms), inside act. */
function runFrames(count: number, gapMs = 16): void {
  for (let index = 0; index < count; index += 1) {
    now += gapMs
    const batch = frames.splice(0)
    act(() => {
      for (const callback of batch) {
        callback(now)
      }
    })
  }
}

/** A 100px sidebar with the target row 500px down, and a textarea the person is typing in. */
function mountSidebar(): {
  container: HTMLDivElement
  typing: HTMLTextAreaElement
  setClientHeight: (height: number) => void
  option: HTMLDivElement
} {
  let scrollTop = 0
  let clientHeight = 100
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight })
  Object.defineProperty(container, 'scrollHeight', { get: () => 1000 })
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (top: number) => {
      scrollTop = top
    }
  })
  container.getBoundingClientRect = () => new DOMRect(0, 0, 240, clientHeight)
  container.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object' && options.top !== undefined) {
      scrollTop = options.top
    }
  }) as HTMLDivElement['scrollTo']
  const option = document.createElement('div')
  option.id = getWorktreeOptionId('wt-target')
  option.dataset.worktreeId = 'wt-target'
  // Focusable like a real row, so a stray focus() on it would show in activeElement.
  option.tabIndex = -1
  option.getBoundingClientRect = () => new DOMRect(0, 500 - scrollTop, 240, 40)
  container.append(option)
  const typing = document.createElement('textarea')
  document.body.append(container, typing)
  typing.focus()
  return {
    container,
    typing,
    setClientHeight: (height) => {
      clientHeight = height
    },
    option
  }
}

// A hidden window, like the headless E2E one on Linux, paints about once a second.
const HIDDEN_WINDOW_FRAME_MS = 1000

function render(args: PendingSidebarRevealArgs): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<Probe args={args} />))
}

describe('usePendingSidebarReveal', () => {
  it('scrolls a passive reveal into view and leaves focus in the textarea', () => {
    const { container, typing } = mountSidebar()
    const args = makeArgs(
      { worktreeId: 'wt-target', behavior: 'auto', passive: true },
      [targetRow],
      { current: container }
    )

    render(args)
    runFrames(1)

    expect(args.markRevealScroll).toHaveBeenCalledWith(440)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 440, behavior: 'auto' })
    runFrames(Math.ceil(REVEAL_HOLD_QUIET_MS / 16) + 1)
    expect(args.clearPendingRevealWorktreeId).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(typing)
  })

  it('drops a passive reveal whose row stays unrendered, as when a filter hides it', () => {
    const { container, typing } = mountSidebar()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto', passive: true }, [], {
      current: container
    })

    render(args)
    runFrames(MAX_REVEAL_RETRIES * 2 + 2)

    expect(args.clearPendingRevealWorktreeId).toHaveBeenCalledOnce()
    expect(container.scrollTo).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(typing)
  })

  it('keeps an asked-for reveal pending until its row renders', () => {
    const { container } = mountSidebar()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto' }, [], {
      current: container
    })

    render(args)
    runFrames(MAX_REVEAL_RETRIES * 2 + 2)

    expect(MAX_REVEAL_RETRIES).toBeGreaterThan(0)
    expect(args.clearPendingRevealWorktreeId).not.toHaveBeenCalled()
  })

  it('keeps a landed reveal and brings the row back when the list shrinks under it', () => {
    const { container, setClientHeight } = mountSidebar()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto' }, [targetRow], {
      current: container
    })

    render(args)
    runFrames(1)
    expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 440, behavior: 'auto' })

    // A late card takes 20px off the list: the row, flush with the bottom edge, drops out.
    setClientHeight(80)
    runFrames(4)

    expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 460, behavior: 'auto' })
    expect(args.clearPendingRevealWorktreeId).not.toHaveBeenCalled()
    runFrames(Math.ceil(REVEAL_HOLD_QUIET_MS / 16) + 1)
    expect(args.clearPendingRevealWorktreeId).toHaveBeenCalledOnce()
  })

  it('keeps staging an unmounted row on a window that paints once a second', () => {
    const { container, option } = mountSidebar()
    option.remove()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto' }, [targetRow], {
      current: container
    })
    const scrollToIndex = args.virtualizer.scrollToIndex as Mock<() => void>
    // The virtualizer needs a few staging passes before the row's element exists.
    scrollToIndex.mockImplementation(() => {
      if (scrollToIndex.mock.calls.length === 4) {
        container.append(option)
      }
    })

    render(args)
    runFrames(12, HIDDEN_WINDOW_FRAME_MS)

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 440, behavior: 'auto' })
  })

  it('brings a landed row back when something rewinds the list between two slow frames', () => {
    const { container } = mountSidebar()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto' }, [targetRow], {
      current: container
    })

    render(args)
    runFrames(1, HIDDEN_WINDOW_FRAME_MS)
    expect(container.scrollTop).toBe(440)
    // A scroll anchor restore puts back the row that was on top before the reveal.
    container.scrollTop = 0
    runFrames(3, HIDDEN_WINDOW_FRAME_MS)

    expect(container.scrollTop).toBe(440)
    expect(args.clearPendingRevealWorktreeId).not.toHaveBeenCalled()
  })

  it('records the scroll anchor where a landed reveal leaves the list', () => {
    const { container } = mountSidebar()
    const recordedAt: number[] = []
    container.addEventListener(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT, () =>
      recordedAt.push(container.scrollTop)
    )
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto' }, [targetRow], {
      current: container
    })

    render(args)
    runFrames(1)

    expect(recordedAt).toContain(440)
  })

  it('lets go of a landed reveal once the person folds a group, and leaves the fold alone', () => {
    const { container } = mountSidebar()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto' }, [targetRow], {
      current: container
    })
    render(args)
    runFrames(2)
    const toggles = args.toggleGroup as Mock<(key: string) => void>
    toggles.mockClear()

    act(() => root?.render(<Probe args={{ ...args, collapsedGroups: new Set(['repo:repo-1']) }} />))
    runFrames(2)

    expect(toggles).not.toHaveBeenCalled()
    expect(args.clearPendingRevealWorktreeId).toHaveBeenCalledOnce()
  })
})
