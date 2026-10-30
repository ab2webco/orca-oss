import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { makeWorktree } from './worktrees-slice-test-fixtures'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory
} from './worktrees-slice-test-harness'

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  }
}))

vi.mock('@/components/worktree-base-fallback-notice', () => ({
  requestWorktreeBaseFallbackNotice: vi.fn()
}))

beforeEach(resetWorktreeSliceModuleMemory)

const HOOKS_WARNING =
  'Commits in this worktree will skip the repo\'s pre-commit hook: Git\'s hooks directory ".husky/_" has no pre-commit, but the repo ships ".husky/pre-commit". Orca did not change core.hooksPath.'

describe('createWorktree warning toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
  })

  it('shows the create warning in a toast naming the workspace', async () => {
    const store = createTestStore()
    mockApi.worktrees.create.mockResolvedValue({
      worktree: makeWorktree({
        id: 'repo1::/path/wt1',
        repoId: 'repo1',
        path: '/path/wt1',
        displayName: 'feature-wt'
      }),
      warning: HOOKS_WARNING
    })

    await store.getState().createWorktree('repo1', 'feature', 'origin/main')

    expect(toast.warning).toHaveBeenCalledWith(
      'Workspace "feature-wt" was created with a warning',
      {
        id: 'worktree-create-warning:repo1::/path/wt1',
        description: HOOKS_WARNING,
        duration: Infinity,
        dismissible: true
      }
    )
  })

  it('shows no toast when the create returns no warning', async () => {
    const store = createTestStore()
    mockApi.worktrees.create.mockResolvedValue({
      worktree: makeWorktree({ id: 'repo1::/path/wt1', repoId: 'repo1', path: '/path/wt1' })
    })

    await store.getState().createWorktree('repo1', 'feature', 'origin/main')

    expect(toast.warning).not.toHaveBeenCalled()
  })
})
