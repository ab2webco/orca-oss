import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { AppState } from '../../../../store/types'
import { ALL_GROUP_KEY, getPRGroupKey, getProjectGroupHeaderKey } from './group-keys'
import { buildProjectGroupingIndex, getProjectGroupingForRepo } from './project-grouping'
import type { ProjectGroupingModel } from './project-grouping'
import type { WorktreeGroupBy } from './row-types'
import { getAgentStatusGroupHeaderKey } from './agent-status-groups'
import type { AgentStatusGroupKey } from './agent-status-groups'
import {
  getSettingsFocusedExecutionHostId,
  getWorktreeExecutionHostId
} from '../../../../../../shared/execution-host'
import { getHostScopedProjectKey } from './project-host-split'

export function getGroupKeyForWorktree(
  groupBy: WorktreeGroupBy,
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  agentStatusByWorktree: ReadonlyMap<string, AgentStatusGroupKey> = new Map(),
  settings?: AppState['settings'],
  projectGrouping?: ProjectGroupingModel
): string | null {
  if (groupBy === 'none') {
    return ALL_GROUP_KEY
  }
  if (groupBy === 'agent-status') {
    return getAgentStatusGroupHeaderKey(agentStatusByWorktree.get(worktree.id) ?? 'idle')
  }
  if (groupBy === 'repo') {
    return getProjectGroupingForRepo(
      worktree.repoId,
      repoMap,
      buildProjectGroupingIndex(projectGrouping)
    ).key
  }
  return `pr:${getPRGroupKey(worktree, repoMap, prCache, settings)}`
}

export function getGroupKeysForWorktree(
  groupBy: WorktreeGroupBy,
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  agentStatusByWorktree: ReadonlyMap<string, AgentStatusGroupKey> = new Map(),
  settings?: AppState['settings'],
  projectGroups: readonly ProjectGroup[] = [],
  projectGrouping?: ProjectGroupingModel
): string[] {
  const groupKey = getGroupKeyForWorktree(
    groupBy,
    worktree,
    repoMap,
    prCache,
    agentStatusByWorktree,
    settings,
    projectGrouping
  )
  if (!groupKey) {
    return []
  }
  if (groupBy !== 'repo') {
    return [groupKey]
  }
  const repo = repoMap.get(worktree.repoId)
  const groupIds: string[] = []
  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const visited = new Set<string>()
  let currentGroupId = repo?.projectGroupId ?? null
  while (currentGroupId && !visited.has(currentGroupId)) {
    const group = groupsById.get(currentGroupId)
    if (!group) {
      // Why: repos can arrive before their remote Project Group metadata; reveal
      // keys must match the top-level fallback rows buildRows actually renders.
      break
    }
    visited.add(currentGroupId)
    groupIds.unshift(currentGroupId)
    const parentId = group.parentGroupId ?? null
    currentGroupId = parentId && groupsById.has(parentId) ? parentId : null
  }
  return [...groupIds.map((id) => getProjectGroupHeaderKey(id)), groupKey]
}

/** The keys to open to reveal a workspace, including its project's per-host section key. */
export function getRevealGroupKeysForWorktree(
  ...args: Parameters<typeof getGroupKeysForWorktree>
): string[] {
  const keys = getGroupKeysForWorktree(...args)
  const [groupBy, worktree, repoMap, , , settings] = args
  const projectKey = keys.at(-1)
  if (groupBy !== 'repo' || projectKey === undefined) {
    return keys
  }
  // Why: a project spanning hosts renders per-host sections (ORCA-1181); an unused key is inert.
  const hostId = getWorktreeExecutionHostId(
    worktree,
    repoMap.get(worktree.repoId),
    getSettingsFocusedExecutionHostId(settings)
  )
  return [...keys, getHostScopedProjectKey(projectKey, hostId)]
}
