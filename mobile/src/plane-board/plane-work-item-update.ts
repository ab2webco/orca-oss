import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
  readPlaneWriteAck,
  type PlaneWriteFailure
} from './plane-write-failure'

export type PlaneWorkItemPatch = {
  priority?: PlaneWorkItemPriority
  /** The whole list: Plane replaces, it does not merge. */
  assigneeIds?: string[]
}

export type PlaneUpdateResult = { ok: true } | PlaneWriteFailure

export type PlaneUpdateRequest = {
  projectId: string
  workItemId: string
  workspaceId: string | null
  patch: PlaneWorkItemPatch
}

const MISSING_SCOPE_MESSAGE = 'This work item is missing the project Plane needs to update it'
const EMPTY_PATCH_MESSAGE = 'Nothing to update'

/** Sends the literal method name so the mobile RPC allowlist test can see it. */
export async function updatePlaneWorkItem(
  client: RpcClient,
  request: PlaneUpdateRequest
): Promise<PlaneUpdateResult> {
  if (!request.projectId || !request.workItemId) {
    return { ok: false, error: MISSING_SCOPE_MESSAGE }
  }
  if (request.patch.priority === undefined && request.patch.assigneeIds === undefined) {
    return { ok: false, error: EMPTY_PATCH_MESSAGE }
  }
  let response
  try {
    response = await client.sendRequest(
      'plane.updateWorkItem',
      {
        projectId: request.projectId,
        workItemId: request.workItemId,
        workspaceId: request.workspaceId ?? undefined,
        updates: request.patch
      },
      PLANE_WRITE_REQUEST_OPTIONS
    )
  } catch (error) {
    return describePlaneWriteRejection(error)
  }
  if (!response.ok) {
    return { ok: false, error: response.error.message }
  }
  return readPlaneWriteAck(response.result, {
    refused: 'Plane refused the update',
    unexpected: 'Unexpected Plane update response'
  })
}
