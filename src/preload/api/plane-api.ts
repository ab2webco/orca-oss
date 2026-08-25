import type {
  PlaneComment,
  PlaneConnectionStatus,
  PlaneCreateWorkItemResult,
  PlaneLabel,
  PlaneMutationResult,
  PlaneProject,
  PlaneState,
  PlaneStateGroup,
  PlaneStateMutationResult,
  PlaneUser,
  PlaneViewer,
  PlaneWorkItem,
  PlaneWorkItemFilter,
  PlaneWorkItemUpdate,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

export type PlaneApi = {
  connect: (args: {
    baseUrl: string
    workspaceSlug: string
    apiKey: string
  }) => Promise<{ ok: true; viewer: PlaneViewer } | { ok: false; error: string }>
  disconnect: (args?: { workspaceId?: string }) => Promise<void>
  selectWorkspace: (args: { workspaceId: PlaneWorkspaceSelection }) => Promise<PlaneConnectionStatus>
  status: () => Promise<PlaneConnectionStatus>
  testConnection: (args?: {
    workspaceId?: string
  }) => Promise<{ ok: true; viewer: PlaneViewer } | { ok: false; error: string }>
  listWorkItems: (args?: {
    projectId?: string
    filter?: PlaneWorkItemFilter
    workspaceId?: string
  }) => Promise<PlaneWorkItem[]>
  searchWorkItems: (args: {
    query: string
    projectId?: string
    workspaceId?: string
  }) => Promise<PlaneWorkItem[]>
  getWorkItem: (args: {
    workItemId: string
    projectId?: string
    workspaceId?: string
  }) => Promise<PlaneWorkItem | null>
  updateWorkItem: (args: {
    projectId: string
    workItemId: string
    workspaceId?: string
    updates: PlaneWorkItemUpdate
  }) => Promise<PlaneMutationResult>
  addWorkItemComment: (args: {
    projectId: string
    workItemId: string
    body: string
    workspaceId?: string
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  listWorkItemComments: (args: {
    projectId: string
    workItemId: string
    workspaceId?: string
  }) => Promise<PlaneComment[]>
  createState: (args: {
    projectId: string
    workspaceId?: string
    name: string
    group: PlaneStateGroup
    color?: string
  }) => Promise<PlaneStateMutationResult>
  updateState: (args: {
    projectId: string
    stateId: string
    workspaceId?: string
    name?: string
    color?: string
    sequence?: number
  }) => Promise<PlaneStateMutationResult>
  deleteState: (args: {
    projectId: string
    stateId: string
    workspaceId?: string
  }) => Promise<PlaneMutationResult>
  listProjects: (args?: { workspaceId?: string }) => Promise<PlaneProject[]>
  listStates: (args: { projectId: string; workspaceId?: string }) => Promise<PlaneState[]>
  listLabels: (args: { projectId: string; workspaceId?: string }) => Promise<PlaneLabel[]>
  listMembers: (args?: { workspaceId?: string; projectId?: string }) => Promise<PlaneUser[]>
  createWorkItem: (args: {
    projectId: string
    workspaceId?: string
    title: string
    stateId?: string
  }) => Promise<PlaneCreateWorkItemResult>
  deleteWorkItem: (args: {
    projectId: string
    workItemId: string
    workspaceId?: string
  }) => Promise<PlaneMutationResult>
  /** Fires when any route (renderer, CLI, paired client) mutates Plane, so open
   *  views can refetch instead of showing stale cards. Returns an unsubscribe. */
  onChanged: (
    callback: (event: { method: string; projectId: string | null }) => void
  ) => () => void
}
