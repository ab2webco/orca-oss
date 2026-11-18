import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { Store } from '../persistence'
import { resolveRepoWorktreeRows, type RepoWorktreeRowDeps } from './repo-worktree-row-resolution'

const REPO = { id: 'repo-1', path: '/work/app', displayName: 'app', kind: 'git' } as Repo
const MAIN_ID = `${REPO.id}::${REPO.path}`

// Mirrors Store.setWorktreeMeta: a first write starts from the defaults, whose lastActivityAt is 0.
function makeStore(initial: Record<string, Partial<WorktreeMeta>> = {}) {
  const metaById: Record<string, WorktreeMeta> = { ...initial } as Record<string, WorktreeMeta>
  const setWorktreeMeta = vi.fn((id: string, updates: Partial<WorktreeMeta>) => {
    const existing: Partial<WorktreeMeta> = metaById[id] ?? { lastActivityAt: 0 }
    metaById[id] = {
      ...existing,
      ...updates,
      instanceId: existing.instanceId ?? updates.instanceId ?? `instance-${id}`
    } as WorktreeMeta
    return metaById[id]
  })
  const store = {
    getRepos: () => [REPO],
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (id: string) => metaById[id],
    setWorktreeMeta
  } as unknown as Store
  return { store, metaById, setWorktreeMeta }
}

function deps(store: Store): RepoWorktreeRowDeps {
  return {
    store,
    scanRepo: async () => ({
      ok: true,
      worktrees: [
        {
          path: REPO.path,
          head: 'abc',
          branch: 'refs/heads/main',
          isBare: false,
          isMainWorktree: true
        }
      ]
    }),
    listFolderWorkspaces: () => []
  }
}

describe('resolveRepoWorktreeRows', () => {
  it('stamps lastActivityAt when the runtime sees a worktree before renderer discovery', async () => {
    // Why: discovery only stamps a worktree with no meta, so meta written here first would keep 0 forever.
    const { store, metaById } = makeStore()

    const [row] = await resolveRepoWorktreeRows(deps(store), REPO, {}, new Map())

    expect(metaById[MAIN_ID].lastActivityAt).toBeGreaterThan(0)
    expect(row.lastActivityAt).toBe(metaById[MAIN_ID].lastActivityAt)
  })

  it('backfills a missing instanceId without re-stamping existing activity', async () => {
    const { store, metaById, setWorktreeMeta } = makeStore({
      [MAIN_ID]: { lastActivityAt: 42 }
    })

    await resolveRepoWorktreeRows(deps(store), REPO, { ...metaById }, new Map())

    expect(setWorktreeMeta).toHaveBeenCalledWith(MAIN_ID, {})
    expect(metaById[MAIN_ID].lastActivityAt).toBe(42)
  })
})
