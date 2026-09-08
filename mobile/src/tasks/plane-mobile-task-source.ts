import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { PlaneWorkItemFilter } from '../../../src/shared/plane-types'
import {
  decodePlaneProjects,
  decodePlaneStates,
  decodePlaneStatus,
  decodePlaneWorkItem,
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

// Mirrors MOBILE_PLANE_WORK_ITEM_DESCRIPTION_RUNTIME_CAPABILITY. It stands for two
// facts at once — the host honours `omitDescription` on the list AND allowlists
// plane.getWorkItem — because asking for the lean list on a host that refuses the
// second leaves every card's body blank (ORCA-464).
export const MOBILE_PLANE_WORK_ITEM_DESCRIPTION_CAPABILITY =
  'mobile.plane-board.work-item-description.v1'

/** True where the detail can read a description the list no longer carries. */
export function isPlaneWorkItemDescriptionReadableByHost(
  capabilities: readonly string[] | undefined
): boolean {
  return capabilities?.includes(MOBILE_PLANE_WORK_ITEM_DESCRIPTION_CAPABILITY) === true
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

/**
 * The open card's description, read on its own because the list stopped carrying
 * it. Returns '' for a work item that genuinely has none — the caller cannot tell
 * that from "omitted" by looking at the list row, which is why this always runs
 * rather than branching on the field being absent (ORCA-464).
 */
export async function fetchPlaneWorkItemDescription(
  client: RpcClient,
  args: { workItemId: string; projectId: string; workspaceId: string | null }
): Promise<string> {
  const item = decodePlaneWorkItem(
    unwrap(
      await client.sendRequest('plane.getWorkItem', {
        workItemId: args.workItemId,
        projectId: args.projectId,
        workspaceId: args.workspaceId ?? undefined
      })
    )
  )
  if (!item) {
    throw new Error('Plane returned a work item this app could not read.')
  }
  return item.description ?? ''
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
    /** Host capabilities; without them the list is requested whole. */
    capabilities?: readonly string[] | undefined
  }
): Promise<PlaneMobileWorkItem[]> {
  // `description` was 58% of this payload and no row renders it, but asking for
  // it to be dropped is only safe where the detail can read it back — otherwise
  // an older host answers with the field gone and nothing can fill it in.
  const omitDescription = isPlaneWorkItemDescriptionReadableByHost(args.capabilities)
  const response = await client.sendRequest('plane.listWorkItems', {
    filter: args.filter,
    projectId: args.projectId ?? undefined,
    workspaceId: args.workspaceId ?? undefined,
    ...(omitDescription ? { omitDescription: true } : {})
  })
  const items = decodePlaneWorkItems(unwrap(response))
  return filterPlaneWorkItemsByQuery(items, args.query).slice(0, PLANE_WORK_ITEM_LIMIT)
}
