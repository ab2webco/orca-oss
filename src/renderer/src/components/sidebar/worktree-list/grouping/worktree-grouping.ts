import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { AppState } from '../../../../store/types'
import { PR_GROUP_META, PR_GROUP_ORDER, getPRGroupKey } from './group-keys'
import {
  AGENT_STATUS_GROUP_META,
  AGENT_STATUS_GROUP_ORDER,
  getAgentStatusGroupHeaderKey
} from './agent-status-groups'
import type { AgentStatusGroupKey } from './agent-status-groups'
import { addRepoIdToGroup, getProjectGroupingForRepo } from './project-grouping'
import type {
  OrderedGroupEntry,
  ProjectGroupingIndex,
  WorktreeGroupEntry
} from './project-grouping'
import type {
  ImportedWorktreesCardCandidate,
  NewExternalWorktreesInboxCandidate,
  PendingCreationRef,
  WorktreeGroupBy
} from './row-types'
import { getManualOrderAnchorRepo, sortProjectEntries } from './section-order'
import type { ProjectHostKeying, ScopedProjectKey } from './project-host-split'

/** Buckets worktrees into their sections and returns them in render order. */
export function buildOrderedGroups(args: {
  groupBy: WorktreeGroupBy
  naturalWorktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
  prCache: Record<string, unknown> | null
  settings: AppState['settings'] | undefined
  agentStatusByWorktree: ReadonlyMap<string, AgentStatusGroupKey>
  projectIndex: ProjectGroupingIndex | null
  placeholderRepoIds: ReadonlySet<string>
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>
  newExternalWorktreesInboxByRepo: ReadonlyMap<string, NewExternalWorktreesInboxCandidate>
  pendingByRepo: ReadonlyMap<string, PendingCreationRef[]>
  repoOrder: Map<string, number> | undefined
  projectOrderBy: ProjectOrderBy
  /** Splits a project whose workspaces span hosts into one section per host. */
  projectHostKeying?: ProjectHostKeying
}): OrderedGroupEntry[] {
  const {
    groupBy,
    naturalWorktrees,
    repoMap,
    prCache,
    settings,
    agentStatusByWorktree,
    projectIndex,
    placeholderRepoIds,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo,
    pendingByRepo,
    repoOrder,
    projectOrderBy,
    projectHostKeying
  } = args
  const scopeRepo = (repoId: string, baseKey: string): ScopedProjectKey =>
    projectHostKeying?.forRepo(repoId, baseKey) ?? { key: baseKey }
  const ensureGroup = (
    scoped: ScopedProjectKey,
    entry: () => WorktreeGroupEntry
  ): WorktreeGroupEntry => {
    let group = grouped.get(scoped.key)
    if (!group) {
      group = { ...entry(), ...(scoped.hostId ? { hostId: scoped.hostId } : {}) }
      grouped.set(scoped.key, group)
    }
    return group
  }

  const grouped = new Map<string, WorktreeGroupEntry>()
  for (const w of naturalWorktrees) {
    let key: string
    let label: string
    let repo: Repo | undefined
    if (groupBy === 'repo') {
      const grouping = getProjectGroupingForRepo(w.repoId, repoMap, projectIndex)
      const scoped = projectHostKeying?.forWorktree(w, grouping.key) ?? { key: grouping.key }
      key = scoped.key
      label = grouping.label
      repo = grouping.repo
      ensureGroup(scoped, () => ({ label, items: [], repo, repoIds: new Set() }))
    } else if (groupBy === 'agent-status') {
      const agentStatus = agentStatusByWorktree.get(w.id) ?? 'idle'
      key = getAgentStatusGroupHeaderKey(agentStatus)
      label = AGENT_STATUS_GROUP_META[agentStatus].label
    } else {
      const prGroup = getPRGroupKey(w, repoMap, prCache, settings)
      key = `pr:${prGroup}`
      label = PR_GROUP_META[prGroup].label
    }
    if (!grouped.has(key)) {
      grouped.set(key, { label, items: [], repo, repoIds: new Set() })
    }
    const group = grouped.get(key)!
    group.items.push(w)
    addRepoIdToGroup(group, w.repoId)
  }
  // Why: a repo can need its section before any worktree lands in it; it joins its host's one.
  const addRepoSection = (repoId: string, fallbackRepo?: Repo): void => {
    const grouping = getProjectGroupingForRepo(repoId, repoMap, projectIndex)
    const group = ensureGroup(scopeRepo(repoId, grouping.key), () => ({
      label: grouping.label,
      items: [],
      repo: grouping.repo ?? fallbackRepo,
      repoIds: new Set()
    }))
    addRepoIdToGroup(group, repoId)
  }
  if (groupBy === 'repo') {
    for (const repoId of placeholderRepoIds) {
      // Why: stale IDs passed by older snapshots must not render an "Unknown" project header.
      if (getProjectGroupingForRepo(repoId, repoMap, projectIndex).repo) {
        addRepoSection(repoId)
      }
    }
    for (const [repoId, candidate] of importedWorktreesByRepo) {
      addRepoSection(repoId, candidate.repo)
    }
    // Why: the default policy removes pinned worktrees from natural groups,
    // but actionable inbox rows still need a project section to render in.
    for (const [repoId, candidate] of newExternalWorktreesInboxByRepo) {
      addRepoSection(repoId, candidate.repo)
    }
    // Why: a first create in a repo has no group yet; the in-progress row nests under its repo.
    for (const repoId of pendingByRepo.keys()) {
      addRepoSection(repoId)
    }
  }

  const orderedGroups: OrderedGroupEntry[] = []
  if (groupBy === 'pr-status') {
    for (const prGroup of PR_GROUP_ORDER) {
      const key = `pr:${prGroup}`
      const group = grouped.get(key)
      if (group) {
        orderedGroups.push([key, group])
      }
    }
  } else if (groupBy === 'agent-status') {
    // Why: V30 draws only the agent states that have workspaces.
    for (const agentStatus of AGENT_STATUS_GROUP_ORDER) {
      const key = getAgentStatusGroupHeaderKey(agentStatus)
      const group = grouped.get(key)
      if (group) {
        orderedGroups.push([key, group])
      }
    }
  } else {
    for (const group of grouped.values()) {
      // Why: logical project headers can contain multiple host setup repos.
      // Use the repo that anchors manual order so drag and actions target the
      // same persisted order source the row sorter reads.
      group.repo = getManualOrderAnchorRepo(group, repoMap, repoOrder)
    }
    // Why: project header order is its own user choice (projectOrderBy),
    // decoupled from workspace sortBy. Manual uses the canonical repoOrder so
    // header drag has a stable source of truth; Recent follows activity.
    const entries = sortProjectEntries(Array.from(grouped.entries()), projectOrderBy, repoOrder)
    // Why: large imported repo sets can have one group per repo; spreading
    // those entries into push can exceed V8's argument limit.
    for (const entry of entries) {
      orderedGroups.push(entry)
    }
  }
  return orderedGroups
}
