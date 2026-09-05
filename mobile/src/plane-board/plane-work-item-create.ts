import type { RpcClient } from '../transport/rpc-client'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
  type PlaneWriteFailure
} from './plane-write-failure'

export type PlaneCreateResult = { ok: true; id: string; identifier: string } | PlaneWriteFailure

export type PlaneCreateRequest = {
  projectId: string
  workspaceId: string | null
  name: string
  /** The column the card lands in: the one the user is looking at. */
  stateId: string
}

const MISSING_SCOPE_MESSAGE =
  'This board is missing the project or column Plane needs for a new card'
const MISSING_TITLE_MESSAGE = 'Give the card a title'

/** Sends the literal method name so the mobile RPC allowlist test can see it
 *  (a computed name would not be enforced). */
export async function createPlaneWorkItem(
  client: RpcClient,
  request: PlaneCreateRequest
): Promise<PlaneCreateResult> {
  if (!request.projectId || !request.stateId) {
    return { ok: false, error: MISSING_SCOPE_MESSAGE }
  }
  const title = request.name.trim()
  if (!title) {
    return { ok: false, error: MISSING_TITLE_MESSAGE }
  }
  let response
  try {
    response = await client.sendRequest(
      'plane.createWorkItem',
      {
        projectId: request.projectId,
        workspaceId: request.workspaceId ?? undefined,
        title,
        stateId: request.stateId
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
  // refused create, which would otherwise read as success with no card behind it.
  if (result && typeof result === 'object' && 'ok' in result) {
    const outcome = result as { ok: unknown; error?: unknown; id?: unknown; identifier?: unknown }
    if (outcome.ok === true) {
      return typeof outcome.id === 'string' && typeof outcome.identifier === 'string'
        ? { ok: true, id: outcome.id, identifier: outcome.identifier }
        : { ok: false, error: 'Unexpected Plane create response' }
    }
    return {
      ok: false,
      error: typeof outcome.error === 'string' ? outcome.error : 'Plane refused the new card'
    }
  }
  return { ok: false, error: 'Unexpected Plane create response' }
}
