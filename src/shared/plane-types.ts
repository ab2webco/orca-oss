// Connection unit = "workspace" = one (baseUrl, workspaceSlug) pair. A single
// Plane Personal Access Token is account-level and may be reused across
// multiple workspace rows (see PlaneConnectArgs).
export type PlaneWorkspace = {
  id: string
  baseUrl: string
  workspaceSlug: string
  displayName?: string
}

export type PlaneViewer = {
  id: string
  displayName: string
  email: string | null
  avatarUrl?: string
}

export type PlaneWorkspaceSelection = string | 'all'

export type PlaneConnectionStatus = {
  connected: boolean
  viewer: PlaneViewer | null
  workspaces?: PlaneWorkspace[]
  activeWorkspaceId?: string | null
  selectedWorkspaceId?: PlaneWorkspaceSelection | null
  // Set when a stored token file exists but could not be decrypted, so the
  // UI can explain reads failing while the connection still looks saved.
  credentialError?: string
}

export type PlaneProject = {
  id: string
  identifier: string
  name: string
  workspaceSlug?: string
  workspaceId?: string
}

export type PlaneState = {
  id: string
  name: string
  group: string
  sequence?: number
  color?: string
}

export type PlaneLabel = {
  id: string
  name: string
  color?: string
}

export type PlaneUser = {
  id: string
  displayName: string
  email?: string | null
  avatarUrl?: string
}

// Static priority set (not fetched from the API), unlike Jira priorities.
export type PlaneWorkItemPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

export type PlaneWorkItem = {
  id: string
  identifier: string
  sequenceId: number
  workspaceSlug?: string
  workspaceId?: string
  title: string
  description?: string
  url: string
  project: PlaneProject
  state: PlaneState
  labels: string[]
  // Label UUIDs alongside the display names in `labels`, so incremental
  // label add/remove can compute a new id set without a separate read.
  labelIds?: string[]
  assignees?: PlaneUser[]
  priority?: PlaneWorkItemPriority
  parentId?: string | null
  createdBy?: string
  updatedAt: string
  createdAt: string
}

// Hints the CLI passes so the runtime can resolve the enclosing worktree for
// the `--current` shortcut. Mirrors LinearCurrentIssueContextHints.
export type PlaneCurrentWorkItemContextHints = {
  worktreeId?: string
  terminalHandle?: string
  cwd?: string
  remote?: boolean
}

// Result of resolving the Plane work item linked to the current worktree. Ids
// come from the persisted worktree link; workItem is the fetched item (null if
// the link exists but the item could not be retrieved).
export type PlaneCurrentWorkItem = {
  identifier: string
  projectId: string
  workspaceId?: string
  url?: string
  workItem: PlaneWorkItem | null
}

// Result of attaching a Plane work item to the current worktree after the fact
// (for worktrees not created from a task). `no_worktree` means the caller is
// not inside an Orca-managed worktree; `work_item_not_found` means the given
// id/project did not resolve to a real Plane work item, so nothing was linked.
export type PlaneLinkCurrentWorkItemResult =
  | { ok: true; linked: PlaneCurrentWorkItem }
  | { ok: false; error: 'no_worktree' | 'work_item_not_found' }

// Result of clearing the Plane link on the current worktree. `no_worktree`
// mirrors the link path: the caller is not inside an Orca-managed worktree.
export type PlaneUnlinkCurrentWorkItemResult =
  | { ok: true; worktreeId: string }
  | { ok: false; error: 'no_worktree' }

export type PlaneComment = {
  id: string
  body: string
  createdAt: string
  updatedAt?: string
  user?: PlaneUser
}

export type PlaneWorkItemUpdate = {
  title?: string
  description?: string
  labelIds?: string[]
  assigneeIds?: string[]
  priority?: PlaneWorkItemPriority
  stateId?: string
  startDate?: string
  targetDate?: string
  parentId?: string | null
}

export type PlaneWorkItemFilter = 'everything' | 'assigned' | 'created' | 'all' | 'done'

export type PlaneConnectArgs = {
  baseUrl: string
  workspaceSlug: string
  apiKey: string
}

export type PlaneCreateWorkItemArgs = {
  projectId: string
  title: string
  workspaceId?: PlaneWorkspaceSelection | null
  description?: string
  stateId?: string
  assigneeIds?: string[]
  labelIds?: string[]
  priority?: PlaneWorkItemPriority
  startDate?: string
  targetDate?: string
  parentId?: string | null
}

export type PlaneCreateWorkItemResult =
  | { ok: true; id: string; identifier: string; url: string }
  | { ok: false; error: string }

export type PlaneMutationResult = { ok: true } | { ok: false; error: string }

// Plane's fixed set of state groups a column can belong to.
export type PlaneStateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'

export type PlaneCreateStateArgs = {
  projectId: string
  workspaceId?: PlaneWorkspaceSelection | null
  name: string
  group: PlaneStateGroup
  color?: string
}

export type PlaneUpdateStateArgs = {
  projectId: string
  workspaceId?: PlaneWorkspaceSelection | null
  stateId: string
  name?: string
  color?: string
  // Board column order is Plane's `sequence`; a reorder PATCHes new sequences.
  sequence?: number
}

export type PlaneDeleteStateArgs = {
  projectId: string
  workspaceId?: PlaneWorkspaceSelection | null
  stateId: string
}

// A create/update returns the resulting state so the board can insert/relabel
// the column without a full refetch race.
export type PlaneStateMutationResult =
  | { ok: true; state: PlaneState }
  | { ok: false; error: string }

export type PlaneDeleteWorkItemArgs = {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}

// Plane's relation_type set (list_work_item_relations groups results by these);
// the CLI exposes a friendlier alias set that maps onto these verbatim.
export type PlaneRelationType =
  | 'relates_to'
  | 'blocking'
  | 'blocked_by'
  | 'duplicate'
  | 'start_after'
  | 'start_before'
  | 'finish_after'
  | 'finish_before'

export type PlaneWorkItemRelation = {
  id: string
  relationType: PlaneRelationType
  relatedWorkItemId: string
  name?: string
  sequenceId?: number
}

export type PlaneAddRelationArgs = {
  projectId: string
  workItemId: string
  relationType: PlaneRelationType
  relatedWorkItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}

export type PlaneWorkItemLink = {
  id: string
  url: string
  title?: string
}

export type PlaneAddLinkArgs = {
  projectId: string
  workItemId: string
  url: string
  title?: string
  workspaceId?: PlaneWorkspaceSelection | null
}

export type PlaneDeleteLinkArgs = {
  projectId: string
  workItemId: string
  linkId: string
  workspaceId?: PlaneWorkspaceSelection | null
}

export type PlaneLinkMutationResult =
  | { ok: true; link: PlaneWorkItemLink }
  | { ok: false; error: string }

export type PlaneCreateLabelArgs = {
  projectId: string
  name: string
  color?: string
  workspaceId?: PlaneWorkspaceSelection | null
}

export type PlaneLabelMutationResult =
  | { ok: true; label: PlaneLabel }
  | { ok: false; error: string }
