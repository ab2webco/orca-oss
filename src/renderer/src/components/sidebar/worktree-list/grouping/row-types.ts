import type React from 'react'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { DetectedWorktree, Worktree } from '../../../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { ProjectUrgency } from './project-urgency-tier'

export type WorktreeGroupBy = 'none' | 'agent-status' | 'repo' | 'pr-status'
export type PinnedWorktreeDisplayPolicy = 'single-location' | 'duplicate-in-groups'

export function getPinnedWorktreeDisplayPolicy(
  settings?: { showPinnedWorktreesInGroups?: boolean } | null
): PinnedWorktreeDisplayPolicy {
  return settings?.showPinnedWorktreesInGroups === true ? 'duplicate-in-groups' : 'single-location'
}

/** An idle repo project drawn as one row (ORCA-1216); absent on active projects. */
export type IdleProjectFold = {
  state: 'folded' | 'open'
  /** `collapsedGroups` key (getIdleProjectOpenKey) whose presence means the person unfolded it. */
  key: string
  workspaceCount: number
  /** What clicking the row opens: the most recent workspace, main on a tie. */
  openWorktree: Worktree
  worktreeIds: readonly string[]
}

export type GroupHeaderRow = {
  type: 'header'
  key: string
  label: string
  count: number
  tone: string
  icon?: React.ComponentType<{ className?: string }>
  repo?: Repo
  projectGroup?: ProjectGroup | { id: null; name: 'Ungrouped'; tabOrder: number }
  projectGroupDepth?: number
  hostId?: ExecutionHostId
  hostWorktreeCounts?: ReadonlyMap<ExecutionHostId, number>
  hostWorktreeIds?: ReadonlyMap<ExecutionHostId, readonly string[]>
  worktreeIds?: readonly string[]
  fold?: IdleProjectFold
  /** Repo headers: the newest workspace activity, absent when none has a timestamp. */
  lastActivityAt?: number
  /** The collapsible group that holds idle projects (ORCA-1216 §2.3); `count` is its project count. */
  idleProjectsGroup?: { collapsed: boolean }
  /** Active repo headers (ORCA-1216 §4): tier, the reason the header shows, and its frozen entry. */
  urgency?: ProjectUrgency & { enteredAt: number }
}

export type WorktreeRow = {
  type: 'item'
  rowKey: string
  sectionKey: string
  worktree: Worktree
  repo: Repo | undefined
  depth: number
  groupDepth: number
  lineageTrail: boolean[]
  isLastLineageChild: boolean
  lineageChildCount: number
  lineageGroupKey?: string
  lineageCollapsed?: boolean
  hostContextLabel?: string
  /** Drawn under a host header, which already names the host. */
  underHostHeader?: true
}

export type ImportedWorktreesCardCandidate = {
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
}

export type ImportedWorktreesCardRow = {
  type: 'imported-worktrees-card'
  key: string
  repo: Repo
  hiddenWorktrees: DetectedWorktree[]
  placement: 'repo-group' | 'pinned-fallback'
}

export type NewExternalWorktreesInboxCandidate = {
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type NewExternalWorktreesInboxRow = {
  type: 'new-external-worktrees-inbox'
  key: string
  repo: Repo
  inboxWorktrees: DetectedWorktree[]
}

export type PendingCreationRow = {
  type: 'pending-creation'
  key: string
  creationId: string
  repo: Repo | undefined
}

export type FolderWorkspaceRow = {
  type: 'folder-workspace'
  key: string
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
  depth: number
  groupDepth: number
  underHostHeader?: true
}

/** Minimal shape buildRows needs for an in-flight create. Deliberately not the
 *  full PendingWorktreeCreation: row identity depends only on which creates
 *  exist and their repo, so callers can subscribe on this stable shape and keep
 *  progress-field churn (phase/loaderVisible) from rebuilding the whole list. */
export type PendingCreationRef = { creationId: string; repoId: string }

export type Row =
  | GroupHeaderRow
  | WorktreeRow
  | ImportedWorktreesCardRow
  | NewExternalWorktreesInboxRow
  | PendingCreationRow
  | FolderWorkspaceRow
