import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'

type TargetWorktree = { id: string; path: string }

/** The worktree a repo's Settings reads and opens files in: the active one when it is this repo's,
 *  else the main checkout, else the repo root. */
export function repositoryTargetWorktreeOf(
  activeWorktreeId: string | null,
  repo: Pick<Repo, 'id' | 'path'>,
  worktrees: readonly Pick<Worktree, 'id' | 'path' | 'isMainWorktree'>[]
): TargetWorktree {
  const pick = (worktree: TargetWorktree): TargetWorktree => ({
    id: worktree.id,
    path: worktree.path
  })
  if (activeWorktreeId && getRepoIdFromWorktreeId(activeWorktreeId) === repo.id) {
    const active = worktrees.find((worktree) => worktree.id === activeWorktreeId)
    return active ? pick(active) : { id: activeWorktreeId, path: repo.path }
  }
  const fallback =
    worktrees.find((worktree) => worktree.isMainWorktree) ??
    worktrees.find((worktree) => worktree.path === repo.path) ??
    worktrees[0]
  return fallback ? pick(fallback) : { id: `${repo.id}::${repo.path}`, path: repo.path }
}
