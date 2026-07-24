// Plane work-item write-back (plane-task-provider Slice 5): update (partial
// PATCH), add comment, list comments. No create/delete -- those are v1.1
// (see the approved MVP scope decision). Split from work-items.ts to stay
// under the oxlint max-lines cap without a suppression; reuses its
// project-scoped path builder so the two files never drift on routing.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  getClients,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import { boundedIntegrationErrorLog } from '../integration-error-message'
import { markdownToPlaneHtml } from './plane-html-markdown'
import {
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import { mapPlaneComment } from './plane-work-item-mappers'
import { workItemsBase } from './work-items'
import type {
  PlaneComment,
  PlaneMutationResult,
  PlaneWorkItemUpdate,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

type PlaneRecord = Record<string, unknown>

function resolveClient(
  workspaceId: PlaneWorkspaceSelection | null | undefined
): PlaneClientForWorkspace | undefined {
  return getClients(workspaceId)[0]
}

function commentsPath(
  client: PlaneClientForWorkspace,
  projectId: string,
  workItemId: string
): string {
  return `${workItemsBase(client, projectId)}${encodeURIComponent(workItemId)}/comments/`
}

function commentsQuery(cursor: string | undefined): string {
  const params = new URLSearchParams({ per_page: '100' })
  if (cursor) {
    params.set('cursor', cursor)
  }
  return params.toString()
}

// Only keys explicitly present in `updates` are written -- a key omitted from
// the caller's object must never turn into an `undefined` value in the PATCH
// body (Plane would treat that differently from the key being absent).
function buildUpdateBody(updates: PlaneWorkItemUpdate): PlaneRecord {
  const body: PlaneRecord = {}
  if (updates.title !== undefined) {
    body.name = updates.title
  }
  if (updates.description !== undefined) {
    body.description_html = markdownToPlaneHtml(updates.description)
  }
  if (updates.stateId !== undefined) {
    body.state = updates.stateId
  }
  if (updates.assigneeIds !== undefined) {
    body.assignees = updates.assigneeIds
  }
  if (updates.labelIds !== undefined) {
    body.labels = updates.labelIds
  }
  if (updates.priority !== undefined) {
    body.priority = updates.priority
  }
  if (updates.startDate !== undefined) {
    body.start_date = updates.startDate
  }
  if (updates.targetDate !== undefined) {
    body.target_date = updates.targetDate
  }
  if (updates.parentId !== undefined) {
    body.parent = updates.parentId
  }
  return body
}

function toMutationError(error: unknown, fallback: string): { ok: false; error: string } {
  console.warn('[plane]', fallback, boundedIntegrationErrorLog(error))
  return { ok: false, error: error instanceof Error ? error.message : fallback }
}

// General write-back primitive backing the MVP's set-state + assign (the UI
// only exposes those two in v1); the other fields are implemented here so a
// later v1.1 UI slice does not need a second write path.
export async function updateWorkItem(args: {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
  updates: PlaneWorkItemUpdate
}): Promise<PlaneMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const body = buildUpdateBody(args.updates)
    await planeRequest(
      client,
      `${workItemsBase(client, args.projectId)}${encodeURIComponent(args.workItemId)}/`,
      { method: 'PATCH', body: JSON.stringify(body) }
    )
    return { ok: true }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to update work item.')
  } finally {
    release()
  }
}

export async function addWorkItemComment(args: {
  projectId: string
  workItemId: string
  body: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const created = await planeRequest<PlaneRecord>(
      client,
      commentsPath(client, args.projectId, args.workItemId),
      {
        method: 'POST',
        body: JSON.stringify({ comment_html: markdownToPlaneHtml(args.body) })
      }
    )
    return { ok: true, id: typeof created.id === 'string' ? created.id : '' }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to add comment.')
  } finally {
    release()
  }
}

export async function listWorkItemComments(args: {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneComment[]> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return []
  }
  await acquire()
  try {
    const budget = new IntegrationPaginationBudget()
    const raws = await fetchAllPlanePages<PlaneRecord>(
      (cursor) =>
        planeRequest<PlanePage<PlaneRecord>>(
          client,
          `${commentsPath(client, args.projectId, args.workItemId)}?${commentsQuery(cursor)}`
        ),
      budget,
      INTEGRATION_PAGINATION_MAX_PAGES
    )
    return raws.map(mapPlaneComment)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    console.warn('[plane] listWorkItemComments failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}
