// @vitest-environment happy-dom
// ORCA-1192: a sidebar reveal scrolls the row into view without moving focus, and a passive one
// gives up on a row it cannot render instead of landing later.
import { act, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Virtualizer } from '@tanstack/react-virtual'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import { makeWorktree } from '@/store/slices/store-test-helpers'
import type { RenderRow } from '../listing/render-row'
import { getWorktreeOptionId } from '../rows/option-dom'
import { MAX_REVEAL_RETRIES, type PendingSidebarRevealArgs } from './pending-reveal-inputs'
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

afterEach(() => {
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
    // Why synchronous: the reveal's frame work runs inside act so the assertions see it.
    schedulePendingRevealFrame: (callback) => callback(0),
    cancelPendingRevealFrames: vi.fn()
  }
}

/** A 100px sidebar with the target row 500px down, and a textarea the person is typing in. */
function mountSidebar(): { container: HTMLDivElement; typing: HTMLTextAreaElement } {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientHeight', { value: 100 })
  container.getBoundingClientRect = () => new DOMRect(0, 0, 240, 100)
  container.scrollTo = vi.fn()
  const option = document.createElement('div')
  option.id = getWorktreeOptionId('wt-target')
  option.dataset.worktreeId = 'wt-target'
  // Focusable like a real row, so a stray focus() on it would show in activeElement.
  option.tabIndex = -1
  option.getBoundingClientRect = () => new DOMRect(0, 500, 240, 40)
  container.append(option)
  const typing = document.createElement('textarea')
  document.body.append(container, typing)
  typing.focus()
  return { container, typing }
}

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

    expect(args.markRevealScroll).toHaveBeenCalledWith(440)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 440, behavior: 'auto' })
    expect(args.clearPendingRevealWorktreeId).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(typing)
  })

  it('drops a passive reveal whose row stays unrendered, as when a filter hides it', () => {
    const { container, typing } = mountSidebar()
    const args = makeArgs({ worktreeId: 'wt-target', behavior: 'auto', passive: true }, [], {
      current: container
    })

    render(args)

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

    expect(MAX_REVEAL_RETRIES).toBeGreaterThan(0)
    expect(args.clearPendingRevealWorktreeId).not.toHaveBeenCalled()
  })
})
