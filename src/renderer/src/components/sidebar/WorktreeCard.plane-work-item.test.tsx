// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo, Worktree, WorktreeCardProperty } from '../../../../shared/types'
import type { PlaneWorkItem } from '../../../../shared/plane-types'
import type { CacheEntry } from '../../store/slices/github'

const fetchHostedReviewForBranch = vi.fn()
const fetchIssue = vi.fn()
const fetchLinearIssue = vi.fn()
const fetchPlaneWorkItem = vi.fn()
const openModal = vi.fn()
const openTaskPage = vi.fn()
const updateWorktreeMeta = vi.fn()

let worktreeCardProperties: WorktreeCardProperty[] = ['status', 'plane-issue']
let newCardStyle = false
let planeWorkItemCache: Record<string, CacheEntry<PlaneWorkItem>> = {}
let root: Root | null = null
let container: HTMLDivElement | null = null
let visibilityState: DocumentVisibilityState = 'visible'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      deleteStateByWorktreeId: {},
      fetchHostedReviewForBranch,
      fetchIssue,
      fetchLinearIssue,
      fetchPlaneWorkItem,
      gitConflictOperationByWorktree: {},
      hostedReviewCache: {},
      issueCache: {},
      linearIssueCache: {},
      openModal,
      openTaskPage,
      planeStatus: { connected: true, viewer: null, selectedWorkspaceId: 'selected-workspace' },
      planeWorkItemCache,
      projectGroups: [],
      remoteBranchConflictByWorktreeId: {},
      settings: { experimentalNewWorktreeCardStyle: newCardStyle },
      sshConnectionStates: new Map(),
      sshTargetLabels: new Map(),
      updateWorktreeMeta,
      workspacePortScan: null,
      worktreeCardProperties
    })
}))

vi.mock('@/lib/sidebar-worktree-activation', () => ({
  activateWorktreeFromSidebar: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

// Why: Radix's real open timers can't run under the card's nested hover roots, so the mock
// exposes onOpenChange as a click target and the test drives the details hover explicitly.
vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({
    children,
    onOpenChange
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <>
      <button type="button" data-open-details-hover="" onClick={() => onOpenChange?.(true)} />
      {children}
    </>
  ),
  HoverCardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownStartedAt: () => null
}))

vi.mock('./WorktreeCardAgents', () => ({
  default: () => null
}))

vi.mock('./SshDisconnectedDialog', () => ({
  SshDisconnectedDialog: () => null
}))

vi.mock('./WorktreeContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
  CLOSE_ALL_CONTEXT_MENUS_EVENT: 'orca:test-close-context-menus',
  WORKTREE_NATIVE_CONTEXT_MENU_ATTR: 'data-worktree-native-context-menu',
  WORKTREE_CONTEXT_MENU_SCOPE_ATTR: 'data-orca-context-menu-scope'
}))

vi.mock('./use-worktree-activity-status', () => ({
  useWorktreeActivityStatus: () => 'active'
}))

const LINKED_PLANE_WORK_ITEM = {
  identifier: 'ORCA-149',
  projectId: 'project-1',
  workspaceId: 'item-workspace',
  url: 'https://plane.example.com/ab2web/browse/ORCA-149/'
}

function makeRepo(): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#999999',
    addedAt: 1
  }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: 'repo-1::/repo/worktrees/branch',
    repoId: 'repo-1',
    path: '/repo/worktrees/branch',
    displayName: 'feature/branch',
    branch: 'feature/branch',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedPlaneWorkItem: LINKED_PLANE_WORK_ITEM,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    ...overrides
  }
}

function makePlaneWorkItem(): PlaneWorkItem {
  return {
    id: 'work-item-uuid',
    identifier: 'ORCA-149',
    sequenceId: 149,
    workspaceId: 'item-workspace',
    title: 'Plane work-item chip on workspace cards',
    url: 'https://plane.example.com/ab2web/browse/ORCA-149/',
    project: { id: 'project-1', identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: 'state-1', name: 'In Progress', group: 'started', color: '#F59E0B' },
    labels: ['ui'],
    updatedAt: '2026-07-31T00:00:00.000Z',
    createdAt: '2026-07-31T00:00:00.000Z'
  }
}

async function renderCard(worktree: Worktree = makeWorktree()): Promise<void> {
  const { default: WorktreeCard } = await import('./WorktreeCard')
  act(() => {
    root?.render(<WorktreeCard worktree={worktree} repo={makeRepo()} isActive={false} />)
  })
}

describe('WorktreeCard Plane work item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    worktreeCardProperties = ['status', 'plane-issue']
    newCardStyle = false
    planeWorkItemCache = {}
    visibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it('fetches the linked work item with its own identifier, project and workspace scope', async () => {
    await renderCard()

    expect(fetchPlaneWorkItem).toHaveBeenCalledTimes(1)
    expect(fetchPlaneWorkItem).toHaveBeenCalledWith('ORCA-149', 'project-1', 'item-workspace')
  })

  it('falls back to the selected Plane workspace when the link carries no workspace id', async () => {
    await renderCard(
      makeWorktree({
        linkedPlaneWorkItem: { identifier: 'ORCA-149', projectId: 'project-1' }
      })
    )

    expect(fetchPlaneWorkItem).toHaveBeenCalledWith('ORCA-149', 'project-1', 'selected-workspace')
  })

  it('neither fetches nor renders the chip when the legacy property is hidden', async () => {
    worktreeCardProperties = ['status']

    await renderCard()

    expect(fetchPlaneWorkItem).not.toHaveBeenCalled()
    expect(container?.innerHTML).not.toContain('Linked Plane ORCA-149')
  })

  it('fetches a hidden new-card-style property only after the card details hover opens', async () => {
    worktreeCardProperties = ['status']
    newCardStyle = true

    await renderCard()

    expect(fetchPlaneWorkItem).not.toHaveBeenCalled()

    const openHover = container?.querySelector<HTMLButtonElement>('[data-open-details-hover]')
    expect(openHover).not.toBeNull()
    act(() => {
      openHover?.click()
    })

    expect(fetchPlaneWorkItem).toHaveBeenCalledWith('ORCA-149', 'project-1', 'item-workspace')
  })

  it('skips the fetch while the window is hidden and runs it once visible again', async () => {
    visibilityState = 'hidden'

    await renderCard()

    expect(fetchPlaneWorkItem).not.toHaveBeenCalled()

    visibilityState = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(fetchPlaneWorkItem).toHaveBeenCalledTimes(1)
    expect(fetchPlaneWorkItem).toHaveBeenCalledWith('ORCA-149', 'project-1', 'item-workspace')
  })

  it('renders the badge from a warmed exact-scope cache entry', async () => {
    planeWorkItemCache = {
      'item-workspace::item::ORCA-149': { data: makePlaneWorkItem(), fetchedAt: Date.now() }
    }

    await renderCard()

    expect(container?.innerHTML).toContain('Linked Plane ORCA-149')
  })

  it('ignores a cache entry stored under a different workspace scope', async () => {
    planeWorkItemCache = {
      'other-workspace::item::ORCA-149': { data: makePlaneWorkItem(), fetchedAt: Date.now() }
    }

    await renderCard()

    // Why: the durable link still renders a chip, but the mismatched scope must not supply details.
    expect(container?.innerHTML).toContain('Linked Plane ORCA-149')
    expect(container?.textContent).not.toContain('Plane work-item chip on workspace cards')
  })

  it('routes Open in Orca to the exact cached work item', async () => {
    const cachedItem = makePlaneWorkItem()
    planeWorkItemCache = {
      'item-workspace::item::ORCA-149': { data: cachedItem, fetchedAt: Date.now() }
    }

    await renderCard()

    const openInOrca = [...(container?.querySelectorAll<HTMLElement>('[aria-label]') ?? [])].find(
      (element) => element.getAttribute('aria-label') === 'Open in Orca'
    )
    expect(openInOrca).not.toBeUndefined()

    act(() => {
      openInOrca?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(openTaskPage).toHaveBeenCalledWith({
      taskSource: 'plane',
      openPlaneWorkItem: cachedItem
    })
  })
})
