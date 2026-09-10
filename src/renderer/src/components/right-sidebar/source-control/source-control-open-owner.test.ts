// Regression: opening a file from Source Control passed no owner, so `openFile`
// inherited the app's active runtime. With exactly one saved environment the
// owner resolver's pre-projection fallback then declared a LOCAL worktree owned
// by that environment, and the read went to the server — which answered, quite
// correctly, that it has no worktree by that id: `selector_not_found`. Retry
// re-sent the same call forever because the tab was already stamped.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSourceControlOpenOwner } from './source-control-open-owner'
import {
  getExplicitRuntimeEnvironmentIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner'

const getState = vi.fn()
vi.mock('@/store', () => ({ useAppStore: { getState: () => getState() } }))

const REMOTE = 'env-contabo'

function stateWithFocusedRuntime(
  worktree: { id: string; repoId: string; hostId?: string } | null
): unknown {
  return {
    settings: { activeRuntimeEnvironmentId: REMOTE },
    runtimeEnvironments: [{ id: REMOTE }],
    repos: worktree ? [{ id: worktree.repoId }] : [],
    worktreesByRepo: worktree ? { [worktree.repoId]: [worktree] } : {},
    detectedWorktreesByRepo: {},
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null
  }
}

beforeEach(() => {
  getState.mockReset()
})

describe('resolveSourceControlOpenOwner', () => {
  // The bug, stated as a test: one saved environment, focused, and a worktree
  // that publishes no host fields. Guessing here is what broke the open.
  it('keeps an unstamped worktree local instead of inheriting the focused runtime', () => {
    getState.mockReturnValue(stateWithFocusedRuntime({ id: 'wt-local', repoId: 'repo-1' }))

    expect(resolveSourceControlOpenOwner('wt-local')).toEqual({
      runtimeEnvironmentId: undefined,
      // Why this flag matters: absent alone would let openFile fall back to the
      // active runtime again. It has to say "local", not "unknown".
      suppressActiveRuntimeFallback: true
    })
  })

  // Why this case is here: it is the whole reason the fix picks the EXPLICIT
  // resolver. Given identical state, the inheriting resolver still answers with
  // the focused environment — that answer is what the read used to follow to the
  // wrong host. If these two ever agree, this fix has become a no-op.
  it('differs from the inheriting resolver, which is what sent the read to the server', () => {
    const state = stateWithFocusedRuntime({
      id: 'wt-local',
      repoId: 'repo-1'
    }) as WorktreeRuntimeOwnerState

    expect(getRuntimeEnvironmentIdForWorktree(state, 'wt-local')).toBe(REMOTE)
    expect(getExplicitRuntimeEnvironmentIdForWorktree(state, 'wt-local')).toBeNull()
  })

  it('reports a worktree that really is runtime-owned', () => {
    getState.mockReturnValue(
      stateWithFocusedRuntime({
        id: 'wt-remote',
        repoId: 'repo-1',
        hostId: `runtime:${REMOTE}`
      })
    )

    expect(resolveSourceControlOpenOwner('wt-remote')).toEqual({
      runtimeEnvironmentId: REMOTE,
      suppressActiveRuntimeFallback: false
    })
  })

  it('stays local for a worktree explicitly stamped local', () => {
    getState.mockReturnValue(
      stateWithFocusedRuntime({ id: 'wt-here', repoId: 'repo-1', hostId: 'local' })
    )

    expect(resolveSourceControlOpenOwner('wt-here')).toEqual({
      runtimeEnvironmentId: undefined,
      suppressActiveRuntimeFallback: true
    })
  })
})
