import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import {
  decodePlaneProjects,
  decodePlaneStates,
  decodePlaneStatus,
  decodePlaneWorkItems,
  type PlaneMobileProject,
  type PlaneMobileState,
  type PlaneMobileStatus,
  type PlaneMobileWorkItem
} from './plane-mobile-work-item-read'
import { filterPlaneWorkItemsByQuery } from './plane-work-item-search'

// Mirrors MOBILE_TASKS_PLANE_RUNTIME_CAPABILITY in src/shared/protocol-version.ts.
// Hosts that predate it advertise mobile.tasks.v1 but refuse every plane.* call
// at dispatch, so the Plane source must stay hidden rather than fail silently.
export const MOBILE_TASKS_PLANE_CAPABILITY = 'mobile.tasks.plane.v1'

export const PLANE_HOST_UPDATE_REQUIRED_MESSAGE =
  'Plane tasks need a newer Orca Lab host. Update the desktop app, then reconnect.'

export const PLANE_WORK_ITEM_LIMIT = 100

export function isPlaneSupportedByHost(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(MOBILE_TASKS_PLANE_CAPABILITY) === true
}

export type PlaneMobileAvailability = {
  supported: boolean
  connected: boolean
  status: PlaneMobileStatus | null
}

// Why: mobile hides the Plane source unless both facts hold, and the status read
// is skipped entirely on a host that would refuse it.
export async function readPlaneAvailability(
  capabilities: readonly string[] | undefined,
  sendPlaneStatus: () => Promise<RpcResponse>
): Promise<PlaneMobileAvailability> {
  if (!isPlaneSupportedByHost(capabilities)) {
    return { supported: false, connected: false, status: null }
  }
  const response = await sendPlaneStatus()
  if (!response.ok) {
    return { supported: true, connected: false, status: null }
  }
  try {
    const status = decodePlaneStatus(response.result)
    return { supported: true, connected: status.connected, status }
  } catch {
    return { supported: true, connected: false, status: null }
  }
}

function unwrap(response: RpcResponse): unknown {
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result
}

export async function fetchPlaneStatus(client: RpcClient): Promise<PlaneMobileStatus> {
  return decodePlaneStatus(unwrap(await client.sendRequest('plane.status')))
}

export async function fetchPlaneProjects(
  client: RpcClient,
  workspaceId: string | null
): Promise<PlaneMobileProject[]> {
  const projects = decodePlaneProjects(
    unwrap(
      await client.sendRequest('plane.listProjects', { workspaceId: workspaceId ?? undefined })
    )
  )
  return projects.filter((project) => project.archived !== true)
}

export async function fetchPlaneStates(
  client: RpcClient,
  projectId: string,
  workspaceId: string | null
): Promise<PlaneMobileState[]> {
  return decodePlaneStates(
    unwrap(
      await client.sendRequest('plane.listStates', {
        projectId,
        workspaceId: workspaceId ?? undefined
      })
    )
  )
}

// Why one call: plane.searchWorkItems is a PQL parser that rejects free text, and this
// query is whatever a human typed into "Search Plane tasks…". The rows come back
// unsearched and the text match runs on them — before the cap, so a match past the
// hundredth row is still findable (ORCA-416).
export async function fetchPlaneWorkItems(
  client: RpcClient,
  args: {
    query: string
    filter: PlaneWorkItemFilter
    projectId: string | null
    workspaceId: string | null
  }
): Promise<PlaneMobileWorkItem[]> {
  const response = await client.sendRequest('plane.listWorkItems', {
    filter: args.filter,
    projectId: args.projectId ?? undefined,
    workspaceId: args.workspaceId ?? undefined
  })
  const items = decodePlaneWorkItems(unwrap(response))
  return filterPlaneWorkItemsByQuery(items, args.query).slice(0, PLANE_WORK_ITEM_LIMIT)
}
