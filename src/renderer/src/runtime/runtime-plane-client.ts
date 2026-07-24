import type { GlobalSettings } from '../../../shared/types'
import type {
  PlaneComment,
  PlaneConnectArgs,
  PlaneConnectionStatus,
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
} from '../../../shared/plane-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { isRuntimeProviderSearchQueryWithinLimit } from './runtime-provider-search-bounds'

export type RuntimePlaneSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | null
  | undefined

export type PlaneConnectResult = { ok: true; viewer: PlaneViewer } | { ok: false; error: string }
export type PlaneCommentResult = { ok: true; id: string } | { ok: false; error: string }

function getPlaneRuntimeTarget(
  settings: RuntimePlaneSettings
): ReturnType<typeof getActiveRuntimeTarget> {
  return getActiveRuntimeTarget(settings)
}

export async function planeStatus(settings: RuntimePlaneSettings): Promise<PlaneConnectionStatus> {
  const target = getPlaneRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneConnectionStatus>(target, 'plane.status', undefined, {
        timeoutMs: 15_000
      })
    : window.api.plane.status()
}

export async function planeConnect(
  settings: RuntimePlaneSettings,
  args: PlaneConnectArgs
): Promise<PlaneConnectResult> {
  const target = getPlaneRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneConnectResult>(target, 'plane.connect', args, { timeoutMs: 30_000 })
    : window.api.plane.connect(args)
}

export async function planeDisconnect(
  settings: RuntimePlaneSettings,
  workspaceId?: string | null
): Promise<void> {
  const target = getPlaneRuntimeTarget(settings)
  const args = workspaceId ? { workspaceId } : undefined
  if (target.kind === 'environment') {
    await callRuntimeRpc<{ ok: true }>(target, 'plane.disconnect', args, { timeoutMs: 15_000 })
    return
  }
  await window.api.plane.disconnect(args)
}

export async function planeSelectWorkspace(
  settings: RuntimePlaneSettings,
  workspaceId: PlaneWorkspaceSelection
): Promise<PlaneConnectionStatus> {
  const target = getPlaneRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneConnectionStatus>(
        target,
        'plane.selectWorkspace',
        { workspaceId },
        { timeoutMs: 15_000 }
      )
    : window.api.plane.selectWorkspace({ workspaceId })
}

export async function planeTestConnection(
  settings: RuntimePlaneSettings,
  workspaceId?: string | null
): Promise<PlaneConnectResult> {
  const target = getPlaneRuntimeTarget(settings)
  const args = workspaceId ? { workspaceId } : undefined
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneConnectResult>(target, 'plane.testConnection', args, {
        timeoutMs: 30_000
      })
    : window.api.plane.testConnection(args)
}

export async function planeListWorkItems(
  settings: RuntimePlaneSettings,
  args: { projectId?: string; filter?: PlaneWorkItemFilter; workspaceId?: string | null }
): Promise<PlaneWorkItem[]> {
  const target = getPlaneRuntimeTarget(settings)
  const params = {
    projectId: args.projectId,
    filter: args.filter,
    workspaceId: args.workspaceId ?? undefined
  }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneWorkItem[]>(target, 'plane.listWorkItems', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.listWorkItems(params)
}

export async function planeSearchWorkItems(
  settings: RuntimePlaneSettings,
  query: string,
  projectId?: string,
  workspaceId?: string | null
): Promise<PlaneWorkItem[]> {
  if (!isRuntimeProviderSearchQueryWithinLimit(query)) {
    return []
  }
  const target = getPlaneRuntimeTarget(settings)
  const params = { query, projectId, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneWorkItem[]>(target, 'plane.searchWorkItems', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.searchWorkItems(params)
}

export async function planeGetWorkItem(
  settings: RuntimePlaneSettings,
  workItemId: string,
  projectId?: string,
  workspaceId?: string | null
): Promise<PlaneWorkItem | null> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { workItemId, projectId, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneWorkItem | null>(target, 'plane.getWorkItem', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.getWorkItem(params)
}

export async function planeUpdateWorkItem(
  settings: RuntimePlaneSettings,
  projectId: string,
  workItemId: string,
  updates: PlaneWorkItemUpdate,
  workspaceId?: string | null
): Promise<PlaneMutationResult> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { projectId, workItemId, updates, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneMutationResult>(target, 'plane.updateWorkItem', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.updateWorkItem(params)
}

export async function planeAddWorkItemComment(
  settings: RuntimePlaneSettings,
  projectId: string,
  workItemId: string,
  body: string,
  workspaceId?: string | null
): Promise<PlaneCommentResult> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { projectId, workItemId, body, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneCommentResult>(target, 'plane.addWorkItemComment', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.addWorkItemComment(params)
}

export async function planeListWorkItemComments(
  settings: RuntimePlaneSettings,
  projectId: string,
  workItemId: string,
  workspaceId?: string | null
): Promise<PlaneComment[]> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { projectId, workItemId, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneComment[]>(target, 'plane.listWorkItemComments', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.listWorkItemComments(params)
}

export async function planeListProjects(
  settings: RuntimePlaneSettings,
  workspaceId?: string | null
): Promise<PlaneProject[]> {
  const target = getPlaneRuntimeTarget(settings)
  const args = workspaceId ? { workspaceId } : undefined
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneProject[]>(target, 'plane.listProjects', args, { timeoutMs: 30_000 })
    : window.api.plane.listProjects(args)
}

export async function planeListStates(
  settings: RuntimePlaneSettings,
  projectId: string,
  workspaceId?: string | null
): Promise<PlaneState[]> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { projectId, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneState[]>(target, 'plane.listStates', params, { timeoutMs: 30_000 })
    : window.api.plane.listStates(params)
}

export async function planeCreateState(
  settings: RuntimePlaneSettings,
  args: { projectId: string; name: string; group: PlaneStateGroup; color?: string },
  workspaceId?: string | null
): Promise<PlaneStateMutationResult> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { ...args, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneStateMutationResult>(target, 'plane.createState', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.createState(params)
}

export async function planeUpdateState(
  settings: RuntimePlaneSettings,
  args: { projectId: string; stateId: string; name?: string; color?: string; sequence?: number },
  workspaceId?: string | null
): Promise<PlaneStateMutationResult> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { ...args, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneStateMutationResult>(target, 'plane.updateState', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.updateState(params)
}

export async function planeDeleteState(
  settings: RuntimePlaneSettings,
  args: { projectId: string; stateId: string },
  workspaceId?: string | null
): Promise<PlaneMutationResult> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { ...args, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneMutationResult>(target, 'plane.deleteState', params, {
        timeoutMs: 30_000
      })
    : window.api.plane.deleteState(params)
}

export async function planeListLabels(
  settings: RuntimePlaneSettings,
  projectId: string,
  workspaceId?: string | null
): Promise<PlaneLabel[]> {
  const target = getPlaneRuntimeTarget(settings)
  const params = { projectId, workspaceId: workspaceId ?? undefined }
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneLabel[]>(target, 'plane.listLabels', params, { timeoutMs: 30_000 })
    : window.api.plane.listLabels(params)
}

export async function planeListMembers(
  settings: RuntimePlaneSettings,
  workspaceId?: string | null,
  projectId?: string
): Promise<PlaneUser[]> {
  const target = getPlaneRuntimeTarget(settings)
  const args =
    workspaceId || projectId
      ? { ...(workspaceId ? { workspaceId } : {}), ...(projectId ? { projectId } : {}) }
      : undefined
  return target.kind === 'environment'
    ? callRuntimeRpc<PlaneUser[]>(target, 'plane.listMembers', args, { timeoutMs: 30_000 })
    : window.api.plane.listMembers(args)
}
