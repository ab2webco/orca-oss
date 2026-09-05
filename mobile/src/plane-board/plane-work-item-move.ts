import type { RpcClient } from '../transport/rpc-client'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
  readPlaneWriteAck,
  type PlaneWriteFailure
} from './plane-write-failure'

export type PlaneMoveResult = { ok: true } | PlaneWriteFailure

export type PlaneMoveRequest = {
  projectId: string
  workItemId: string
  stateId: string
  workspaceId: string | null
}

const MISSING_SCOPE_MESSAGE =
  'This work item is missing the project or state Plane needs to move it'

/** Sends the literal method name so the mobile RPC allowlist test can see it
 *  (a computed name would not be enforced). */
export async function movePlaneWorkItem(
  client: RpcClient,
  request: PlaneMoveRequest
): Promise<PlaneMoveResult> {
  if (!request.projectId || !request.workItemId || !request.stateId) {
    return { ok: false, error: MISSING_SCOPE_MESSAGE }
  }
  let response
  try {
    response = await client.sendRequest(
      'plane.updateWorkItem',
      {
        projectId: request.projectId,
        workItemId: request.workItemId,
        workspaceId: request.workspaceId ?? undefined,
        updates: { stateId: request.stateId }
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
    refused: 'Plane refused the move',
    unexpected: 'Unexpected Plane move response'
  })
}
