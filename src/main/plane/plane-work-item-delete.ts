// Plane work-item delete (project-scoped DELETE). Split from
// plane-work-item-writes.ts to stay under the oxlint max-lines cap without a
// suppression; reuses that file's client resolver and error mapper plus
// work-items.ts's project-scoped path builder so routing never drifts.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import { resolveClient, toMutationError } from './plane-work-item-writes'
import { workItemsBase } from './work-items'
import type { PlaneDeleteWorkItemArgs, PlaneMutationResult } from '../../shared/plane-types'

function workItemPath(
  client: PlaneClientForWorkspace,
  projectId: string,
  workItemId: string
): string {
  return `${workItemsBase(client, projectId)}${encodeURIComponent(workItemId)}/`
}

// Deletes a work item (project-scoped). workItemId is the work item UUID; a
// wrong id/UUID surfaces Plane's 404 as the mapped error rather than crashing.
export async function deleteWorkItem(args: PlaneDeleteWorkItemArgs): Promise<PlaneMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    await planeRequest(client, workItemPath(client, args.projectId, args.workItemId), {
      method: 'DELETE'
    })
    return { ok: true }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to delete work item.')
  } finally {
    release()
  }
}
