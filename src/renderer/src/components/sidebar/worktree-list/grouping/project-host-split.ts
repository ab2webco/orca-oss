import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { getProjectGroupingForRepo, type ProjectGroupingIndex } from './project-grouping'

export type ScopedProjectKey = { key: string; hostId?: ExecutionHostId }

/** Resolves a project section's key, split per host only for projects whose workspaces span hosts. */
export type ProjectHostKeying = {
  forWorktree: (worktree: Worktree, baseKey: string) => ScopedProjectKey
  forRepo: (repoId: string, baseKey: string) => ScopedProjectKey
}

export function getHostScopedProjectKey(key: string, hostId: ExecutionHostId): string {
  return `${key}::host:${hostId}`
}

/**
 * Why (ORCA-1181): one project on two hosts must be one section per host, with that host's
 * activity, tier, fold and collapse. Only spanning projects change key, so a single-host
 * sidebar keeps every collapse key the person already saved.
 */
export function buildProjectHostKeying(args: {
  worktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
  projectIndex: ProjectGroupingIndex | null
  defaultHostId: ExecutionHostId
}): ProjectHostKeying {
  const { repoMap, projectIndex, defaultHostId } = args
  const worktreeHost = (worktree: Worktree): ExecutionHostId =>
    getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
  const hostsByKey = new Map<string, Set<ExecutionHostId>>()
  for (const worktree of args.worktrees) {
    const key = getProjectGroupingForRepo(worktree.repoId, repoMap, projectIndex).key
    hostsByKey.set(key, (hostsByKey.get(key) ?? new Set()).add(worktreeHost(worktree)))
  }
  const scope = (baseKey: string, hostId: ExecutionHostId): ScopedProjectKey =>
    (hostsByKey.get(baseKey)?.size ?? 0) > 1
      ? { key: getHostScopedProjectKey(baseKey, hostId), hostId }
      : { key: baseKey }
  return {
    forWorktree: (worktree, baseKey) => scope(baseKey, worktreeHost(worktree)),
    forRepo: (repoId, baseKey) => {
      const repo = repoMap.get(repoId)
      const hostId =
        repo?.connectionId || repo?.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
      return scope(baseKey, hostId)
    }
  }
}
