import type { PlaneMobileState } from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import {
  describePlaneWriteRejection,
  PLANE_WRITE_REQUEST_OPTIONS,
  type PlaneWriteFailure
} from './plane-write-failure'

export type PlaneColumnRenameResult = { ok: true; state: PlaneMobileState } | PlaneWriteFailure

export type PlaneColumnRenameRequest = {
  projectId: string
  workspaceId: string | null
  stateId: string
  name: string
}

const MISSING_SCOPE_MESSAGE = 'This board is missing the project or column Plane needs'
const MISSING_NAME_MESSAGE = 'Give the column a name'
const REFUSED_MESSAGE = 'Plane refused the column change'
const UNEXPECTED_MESSAGE = 'Unexpected Plane column response'

function readRenamedState(result: unknown): PlaneColumnRenameResult {
  // Why not trusting a bare resolve: the host answers { ok: false, error } for a
  // refused write, which would otherwise read as a renamed column.
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    return { ok: false, error: UNEXPECTED_MESSAGE }
  }
  const outcome = result as { ok: unknown; error?: unknown; state?: unknown }
  if (outcome.ok !== true) {
    return { ok: false, error: typeof outcome.error === 'string' ? outcome.error : REFUSED_MESSAGE }
  }
  const state = outcome.state as Partial<PlaneMobileState> | undefined
  if (!state || typeof state.id !== 'string' || typeof state.name !== 'string') {
    return { ok: false, error: UNEXPECTED_MESSAGE }
  }
  return {
    ok: true,
    state: {
      id: state.id,
      name: state.name,
      group: typeof state.group === 'string' ? state.group : '',
      color: typeof state.color === 'string' ? state.color : undefined,
      sequence: typeof state.sequence === 'number' ? state.sequence : undefined
    }
  }
}

/** Sends the literal method name so the mobile RPC allowlist test can see it. */
export async function renamePlaneColumn(
  client: RpcClient,
  request: PlaneColumnRenameRequest
): Promise<PlaneColumnRenameResult> {
  if (!request.projectId || !request.stateId) {
    return { ok: false, error: MISSING_SCOPE_MESSAGE }
  }
  const name = request.name.trim()
  if (!name) {
    return { ok: false, error: MISSING_NAME_MESSAGE }
  }
  let response
  try {
    response = await client.sendRequest(
      'plane.updateState',
      {
        projectId: request.projectId,
        workspaceId: request.workspaceId ?? undefined,
        stateId: request.stateId,
        name
      },
      PLANE_WRITE_REQUEST_OPTIONS
    )
  } catch (error) {
    return describePlaneWriteRejection(error)
  }
  if (!response.ok) {
    return { ok: false, error: response.error.message }
  }
  return readRenamedState(response.result)
}
