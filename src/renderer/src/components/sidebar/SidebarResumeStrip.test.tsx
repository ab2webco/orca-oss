// @vitest-environment happy-dom
// ORCA-1216 §8: after a restore, Retomar names the last active workspace with its age.
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { makeWorktree, TEST_REPO } from '@/store/slices/store-test-helpers'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

type StripState = {
  resumeStripWorkspaceId: string | null
  repos: Repo[]
  worktreesByRepo: Record<string, Worktree[]>
  folderWorkspaces: FolderWorkspace[]
  projectGroups: ProjectGroup[]
  dismissResumeStrip: () => void
}

const mocks = vi.hoisted(() => ({
  state: null as StripState | null,
  activate: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: StripState) => unknown) => selector(mocks.state!)
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: mocks.activate }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

import { i18n } from '../../i18n/i18n'
import { SidebarResumeStrip } from './SidebarResumeStrip'

const NOW = Date.now()
const repo: Repo = { ...TEST_REPO, id: 'repo-1', displayName: 'orca-oss' }
const worktree = makeWorktree({
  id: 'wt-1',
  repoId: 'repo-1',
  displayName: 'orca-1216',
  lastActivityAt: NOW - 3 * 60 * 60_000 - 5 * 60_000
})
const group: ProjectGroup = {
  id: 'group-1',
  name: 'notes',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: NOW,
  updatedAt: NOW
}
const folder: FolderWorkspace = {
  id: 'folder-1',
  projectGroupId: 'group-1',
  name: 'drafts',
  folderPath: '/tmp/drafts',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: NOW - 10 * 60_000,
  createdAt: NOW,
  updatedAt: NOW
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function seed(overrides: Partial<StripState> = {}): StripState {
  const state: StripState = {
    resumeStripWorkspaceId: 'wt-1',
    repos: [repo],
    worktreesByRepo: { 'repo-1': [worktree] },
    folderWorkspaces: [folder],
    projectGroups: [group],
    dismissResumeStrip: vi.fn(),
    ...overrides
  }
  mocks.state = state
  return state
}

function render(): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<SidebarResumeStrip />))
  return host
}

beforeEach(() => {
  mocks.activate.mockReset()
})

afterEach(async () => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  await i18n.changeLanguage('en')
})

describe('SidebarResumeStrip', () => {
  it('names the restored worktree, its project and its age', () => {
    seed()
    const strip = render().querySelector('[data-resume-strip]')

    expect(strip?.querySelector('[data-resume-strip-label]')?.textContent).toBe('Resume')
    expect(strip?.querySelector('[data-resume-strip-target]')?.textContent).toBe(
      'orca-oss · orca-1216'
    )
    expect(strip?.querySelector('[data-activity-age]')?.textContent).toBe('3 h')
  })

  it('reads Retomar in Spanish', async () => {
    await i18n.changeLanguage('es')
    seed()
    const strip = render().querySelector('[data-resume-strip]')

    expect(strip?.querySelector('[data-resume-strip-label]')?.textContent).toBe('Retomar')
    expect(strip?.querySelector('[data-resume-strip-dismiss]')?.getAttribute('aria-label')).toBe(
      'Descartar'
    )
  })

  it('names a folder workspace by its project group', () => {
    seed({ resumeStripWorkspaceId: 'folder:folder-1' })
    const target = render().querySelector('[data-resume-strip-target]')

    expect(target?.textContent).toBe('notes · drafts')
  })

  it('activates and reveals the workspace on click, then goes away', () => {
    const state = seed()
    const strip = render()

    act(() => strip.querySelector<HTMLButtonElement>('[data-resume-strip-open]')?.click())

    expect(mocks.activate).toHaveBeenCalledWith('wt-1')
    expect(state.dismissResumeStrip).toHaveBeenCalledOnce()
  })

  it('dismisses on × without activating', () => {
    const state = seed()
    const strip = render()

    act(() => strip.querySelector<HTMLButtonElement>('[data-resume-strip-dismiss]')?.click())

    expect(state.dismissResumeStrip).toHaveBeenCalledOnce()
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('renders nothing without a restore, or once its workspace is archived or gone', () => {
    seed({ resumeStripWorkspaceId: null })
    expect(render().querySelector('[data-resume-strip]')).toBeNull()
    act(() => root?.unmount())

    seed({ worktreesByRepo: { 'repo-1': [{ ...worktree, isArchived: true }] } })
    expect(render().querySelector('[data-resume-strip]')).toBeNull()
    act(() => root?.unmount())

    seed({ worktreesByRepo: {} })
    expect(render().querySelector('[data-resume-strip]')).toBeNull()
  })
})
