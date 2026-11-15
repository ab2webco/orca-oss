import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { getIdleProjectOpenKey } from './group-keys'
import { isWorkspaceActive, pickProjectOpenWorktree } from './project-activity'
import type { ProjectActivityInputs } from './project-activity'
import { getProjectGroupingForRepo } from './project-grouping'
import type { ProjectGroupingIndex } from './project-grouping'
import type { IdleProjectFold } from './row-types'

/** Project header keys with any active workspace, pinned ones included. */
export function getActiveProjectKeys(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  projectIndex: ProjectGroupingIndex | null,
  inputs: ProjectActivityInputs
): Set<string> {
  const keys = new Set<string>()
  for (const worktree of worktrees) {
    if (isWorkspaceActive(worktree, inputs)) {
      keys.add(getProjectGroupingForRepo(worktree.repoId, repoMap, projectIndex).key)
    }
  }
  return keys
}

export function resolveIdleProjectFold(args: {
  key: string
  items: readonly Worktree[]
  activeProjectKeys: ReadonlySet<string>
  collapsedGroups: ReadonlySet<string>
  /** A pending create, imported card or inbox row the fold would hide. */
  hasProjectNotice: boolean
}): IdleProjectFold | undefined {
  if (args.activeProjectKeys.has(args.key) || args.hasProjectNotice) {
    return undefined
  }
  const openWorktree = pickProjectOpenWorktree(args.items)
  if (!openWorktree) {
    return undefined
  }
  const key = getIdleProjectOpenKey(args.key)
  return {
    state: args.collapsedGroups.has(key) ? 'open' : 'folded',
    key,
    workspaceCount: args.items.length,
    openWorktree,
    worktreeIds: args.items.map((worktree) => worktree.id)
  }
}
