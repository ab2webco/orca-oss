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
  assignees?: PlaneUser[]
  priority?: PlaneWorkItemPriority
  parentId?: string | null
  createdBy?: string
  updatedAt: string
  createdAt: string
}

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

export type PlaneWorkItemFilter = 'assigned' | 'created' | 'all' | 'done'

export type PlaneConnectArgs = {
  baseUrl: string
  workspaceSlug: string
  apiKey: string
}

export type PlaneCreateWorkItemArgs = {
  workspaceSlug?: string
  projectId: string
  title: string
  description?: string
  stateId?: string
  priority?: PlaneWorkItemPriority
}

export type PlaneCreateWorkItemResult =
  | { ok: true; id: string; identifier: string; url: string }
  | { ok: false; error: string }

export type PlaneMutationResult = { ok: true } | { ok: false; error: string }
