import type { PlaneState, PlaneViewer, PlaneWorkItemUpdate } from '../shared/plane-types'
import type { RuntimeClient } from './runtime-client'
import { RuntimeClientError } from './runtime-client'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from './flags'
import {
  getPlanePriorityFlag,
  rejectAllWorkspaceForPlaneWrite,
  resolvePlaneStateId
} from './plane-request-builders'

export type PlaneUpdateWorkItemRequest = {
  projectId: string
  workItemId: string
  workspaceId?: string
  updates: PlaneWorkItemUpdate
}

// Assembles a partial PATCH for `plane save-issue`, resolving --state (name/id)
// and --assignee me client-side against existing RPC reads. Only flags actually
// present become update keys so an omitted field is never written server-side.
export async function buildPlaneSaveIssueRequest(
  flags: Map<string, string | boolean>,
  client: RuntimeClient
): Promise<PlaneUpdateWorkItemRequest> {
  rejectAllWorkspaceForPlaneWrite(flags)
  const workItemId = getRequiredStringFlag(flags, 'id')
  const projectId = getRequiredStringFlag(flags, 'project')
  const workspaceId = getOptionalStringFlag(flags, 'workspace')
  const updates: PlaneWorkItemUpdate = {}

  const title = getOptionalStringFlag(flags, 'title')
  if (title !== undefined) {
    updates.title = title
  }
  if (flags.has('state')) {
    updates.stateId = await resolveStateId(flags, client, projectId, workspaceId)
  }
  if (flags.has('assignee')) {
    updates.assigneeIds = await resolveAssigneeIds(flags, client, workspaceId)
  }
  if (flags.has('priority')) {
    updates.priority = getPlanePriorityFlag(flags, 'priority')
  }
  if (flags.has('label')) {
    updates.labelIds = getRepeatedStringFlag(flags, 'label')
  }

  return { projectId, workItemId, workspaceId, updates }
}

export async function resolveStateId(
  flags: Map<string, string | boolean>,
  client: RuntimeClient,
  projectId: string,
  workspaceId: string | undefined
): Promise<string> {
  const input = getRequiredStringFlag(flags, 'state')
  const response = await client.call<PlaneState[]>('plane.listStates', { projectId, workspaceId })
  return resolvePlaneStateId(response.result, input)
}

export async function resolveAssigneeIds(
  flags: Map<string, string | boolean>,
  client: RuntimeClient,
  workspaceId: string | undefined
): Promise<string[]> {
  const value = getRequiredStringFlag(flags, 'assignee')
  if (value === 'null') {
    return []
  }
  if (value === 'me') {
    return [await resolveViewerId(client, workspaceId)]
  }
  return [value]
}

export async function resolveViewerId(
  client: RuntimeClient,
  workspaceId: string | undefined
): Promise<string> {
  const response = await client.call<PlaneViewer | null>('plane.getMe', { workspaceId })
  if (!response.result?.id) {
    throw new RuntimeClientError(
      'plane_viewer_unavailable',
      'Could not resolve the connected Plane user for --me'
    )
  }
  return response.result.id
}
