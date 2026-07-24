// Plane label create (project-scoped POST to the same `/labels/` route the
// reads use). Split from the write surface to stay under the oxlint max-lines
// cap without a suppression; reuses the shared client resolver + error mapper.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import { mapPlaneLabel } from './plane-work-item-mappers'
import { resolveClient, toMutationError, type PlaneRecord } from './plane-work-item-writes'
import type { PlaneCreateLabelArgs, PlaneLabelMutationResult } from '../../shared/plane-types'

function labelsPath(client: PlaneClientForWorkspace, projectId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(client.workspaceSlug)}/projects/${encodeURIComponent(projectId)}/labels/`
}

export async function createLabel(args: PlaneCreateLabelArgs): Promise<PlaneLabelMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const body: PlaneRecord = { name: args.name }
    if (args.color !== undefined) {
      body.color = args.color
    }
    const created = await planeRequest<PlaneRecord>(client, labelsPath(client, args.projectId), {
      method: 'POST',
      body: JSON.stringify(body)
    })
    return { ok: true, label: mapPlaneLabel(created) }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to create label.')
  } finally {
    release()
  }
}
