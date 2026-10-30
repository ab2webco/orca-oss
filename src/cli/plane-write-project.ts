import type { PlaneWorkItem } from '../shared/plane-types'
import { RuntimeClientError } from './runtime-client'
import type { RuntimeClient } from './runtime-client'

// Mirrors the host's identifier route: PROJ-N resolves workspace-wide and
// ignores projectId, so only a UUID lookup depends on --project.
const PLANE_IDENTIFIER_RE = /^[A-Z0-9]+-\d+$/

// Fetches the work item a write targets. --project may be the project UUID or
// its identifier; a UUID item scoped to an identifier 404s, so retry unscoped.
export async function fetchPlaneWriteWorkItem(
  client: RuntimeClient,
  requestedId: string,
  project: string | undefined,
  workspaceId: string | undefined
): Promise<PlaneWorkItem> {
  const lookup = async (projectId: string | undefined): Promise<PlaneWorkItem | null> =>
    (
      await client.call<PlaneWorkItem | null>('plane.getWorkItem', {
        workItemId: requestedId,
        projectId,
        workspaceId
      })
    ).result
  let workItem = await lookup(project)
  if (!workItem && project && !PLANE_IDENTIFIER_RE.test(requestedId)) {
    workItem = await lookup(undefined)
  }
  if (!workItem) {
    throw new RuntimeClientError(
      'plane_work_item_not_found',
      `Plane work item ${requestedId} not found`
    )
  }
  return workItem
}

// Plane write routes need the project UUID, so the work item's own project is
// authoritative; --project only guards against writing to the wrong one.
export function resolvePlaneWriteProjectId(
  workItem: PlaneWorkItem,
  project: string | undefined
): string {
  const { id, identifier } = workItem.project
  if (
    project !== undefined &&
    project !== id &&
    project.toUpperCase() !== identifier.toUpperCase()
  ) {
    throw new RuntimeClientError(
      'plane_project_mismatch',
      `Plane work item ${workItem.identifier} belongs to project ${identifier}, not ${project}`
    )
  }
  return id
}
