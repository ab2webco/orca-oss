import type { RpcClient } from '../transport/rpc-client'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
  readPlaneWriteAck,
  type PlaneWriteFailure
} from './plane-write-failure'

export type PlaneCommentResult = { ok: true; id: string } | PlaneWriteFailure

export type PlaneCommentRequest = {
  projectId: string
  workItemId: string
  workspaceId: string | null
  body: string
}

const MISSING_SCOPE_MESSAGE = 'This work item is missing the project Plane needs to comment on it'
const EMPTY_BODY_MESSAGE = 'Write a comment'
const ACK_MESSAGES = {
  refused: 'Plane refused the comment',
  unexpected: 'Unexpected Plane comment response'
}

function readCommentAck(result: unknown): PlaneCommentResult {
  const ack = readPlaneWriteAck(result, ACK_MESSAGES)
  if (!ack.ok) {
    return ack
  }
  // readPlaneWriteAck already proved the result is an object with ok: true.
  const id = (result as { id?: unknown }).id
  return typeof id === 'string' ? { ok: true, id } : { ok: false, error: ACK_MESSAGES.unexpected }
}

/** Sends the literal method name so the mobile RPC allowlist test can see it. */
export async function addPlaneWorkItemComment(
  client: RpcClient,
  request: PlaneCommentRequest
): Promise<PlaneCommentResult> {
  if (!request.projectId || !request.workItemId) {
    return { ok: false, error: MISSING_SCOPE_MESSAGE }
  }
  const body = request.body.trim()
  if (!body) {
    return { ok: false, error: EMPTY_BODY_MESSAGE }
  }
  let response
  try {
    response = await client.sendRequest(
      'plane.addWorkItemComment',
      {
        projectId: request.projectId,
        workItemId: request.workItemId,
        body,
        workspaceId: request.workspaceId ?? undefined
      },
      PLANE_WRITE_REQUEST_OPTIONS
    )
  } catch (error) {
    return describePlaneWriteRejection(error)
  }
  if (!response.ok) {
    return { ok: false, error: response.error.message }
  }
  return readCommentAck(response.result)
}
