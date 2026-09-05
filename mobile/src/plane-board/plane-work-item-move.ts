import type { RpcClient } from '../transport/rpc-client'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
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
  const result = response.result
  // Why not trusting a bare resolve: the host answers { ok: false, error } for a
  // refused move, which would otherwise read as success and leave the card moved.
  if (result && typeof result === 'object' && 'ok' in result) {
    const outcome = result as { ok: unknown; error?: unknown }
    if (outcome.ok === true) {
      return { ok: true }
    }
    return {
      ok: false,
      error: typeof outcome.error === 'string' ? outcome.error : 'Plane refused the move'
    }
  }
  return { ok: false, error: 'Unexpected Plane move response' }
}
