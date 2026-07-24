// Plane work-item create (POST). Split from plane-work-item-writes.ts to stay
// under the oxlint max-lines cap without a suppression; reuses that file's
// client resolver and error mapper plus work-items.ts's project-scoped path
// builder so routing never drifts across the write surface.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import { markdownToPlaneHtml } from './plane-html-markdown'
import { mapPlaneWorkItem } from './plane-work-item-mappers'
import { listProjectsForClient } from './plane-work-item-reads'
import { resolveClient, toMutationError, type PlaneRecord } from './plane-work-item-writes'
import { workItemsBase } from './work-items'
import type { PlaneCreateWorkItemArgs, PlaneCreateWorkItemResult } from '../../shared/plane-types'

// Create shares update's field mapping; `name` is always sent (title is
// required on create) while every other field is included only when provided.
function buildCreateBody(args: PlaneCreateWorkItemArgs): PlaneRecord {
  const body: PlaneRecord = { name: args.title }
  if (args.description !== undefined) {
    body.description_html = markdownToPlaneHtml(args.description)
  }
  if (args.stateId !== undefined) {
    body.state = args.stateId
  }
  if (args.assigneeIds !== undefined) {
    body.assignees = args.assigneeIds
  }
  if (args.labelIds !== undefined) {
    body.labels = args.labelIds
  }
  if (args.priority !== undefined) {
    body.priority = args.priority
  }
  if (args.startDate !== undefined) {
    body.start_date = args.startDate
  }
  if (args.targetDate !== undefined) {
    body.target_date = args.targetDate
  }
  if (args.parentId !== undefined) {
    body.parent = args.parentId
  }
  return body
}

// identifier (PROJECT-N) needs the project's short identifier, which the create
// response carries as `project_identifier`; fall back to resolving it from the
// project list when a tenant omits it so the returned identifier/url are never
// malformed.
async function resolveCreatedProjectIdentifier(
  client: PlaneClientForWorkspace,
  created: PlaneRecord,
  projectId: string
): Promise<string> {
  const fromResponse =
    typeof created.project_identifier === 'string' ? created.project_identifier : ''
  if (fromResponse) {
    return fromResponse
  }
  const projects = await listProjectsForClient(client)
  return projects.find((project) => project.id === projectId)?.identifier ?? ''
}

// Creates a work item in one project (POST to the same base updateWorkItem
// PATCHes). identifier/url are derived exactly as the read mapper does so a
// created item reads back identically to a listed one.
export async function createWorkItem(
  args: PlaneCreateWorkItemArgs
): Promise<PlaneCreateWorkItemResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const created = await planeRequest<PlaneRecord>(client, workItemsBase(client, args.projectId), {
      method: 'POST',
      body: JSON.stringify(buildCreateBody(args))
    })
    const identifier = await resolveCreatedProjectIdentifier(client, created, args.projectId)
    const mapped = mapPlaneWorkItem(created, {
      baseUrl: client.baseUrl,
      workspaceSlug: client.workspaceSlug,
      project: { id: args.projectId, identifier, name: identifier || 'Untitled project' }
    })
    return { ok: true, id: mapped.id, identifier: mapped.identifier, url: mapped.url }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to create work item.')
  } finally {
    release()
  }
}
