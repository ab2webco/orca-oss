// Plane work-item URL links: create, list, delete (project-scoped, nested under
// the work item's `/links/` sub-route). Exposed on the CLI as `plane attach` to
// avoid clashing with the worktree-linking `plane link`. Split from the write
// surface to stay under the oxlint max-lines cap without a suppression.
//
// Endpoint shape mirrors the Plane MCP (create_work_item_link / list / delete);
// the `title` field is assumed additive — verify against a live tenant.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import { boundedIntegrationErrorLog } from '../integration-error-message'
import { resolveClient, toMutationError, type PlaneRecord } from './plane-work-item-writes'
import { workItemsBase } from './work-items'
import type {
  PlaneAddLinkArgs,
  PlaneDeleteLinkArgs,
  PlaneLinkMutationResult,
  PlaneMutationResult,
  PlaneWorkItemLink,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

function linksPath(client: PlaneClientForWorkspace, projectId: string, workItemId: string): string {
  return `${workItemsBase(client, projectId)}${encodeURIComponent(workItemId)}/links/`
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function mapLink(raw: unknown): PlaneWorkItemLink {
  const link = (raw && typeof raw === 'object' ? raw : {}) as PlaneRecord
  return {
    id: asString(link.id),
    url: asString(link.url),
    title: asString(link.title) || undefined
  }
}

export async function addWorkItemLink(args: PlaneAddLinkArgs): Promise<PlaneLinkMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    const body: PlaneRecord = { url: args.url }
    if (args.title !== undefined) {
      body.title = args.title
    }
    const created = await planeRequest<PlaneRecord>(
      client,
      linksPath(client, args.projectId, args.workItemId),
      { method: 'POST', body: JSON.stringify(body) }
    )
    return { ok: true, link: mapLink(created) }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to add work item link.')
  } finally {
    release()
  }
}

export async function deleteWorkItemLink(args: PlaneDeleteLinkArgs): Promise<PlaneMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    await planeRequest(
      client,
      `${linksPath(client, args.projectId, args.workItemId)}${encodeURIComponent(args.linkId)}/`,
      { method: 'DELETE' }
    )
    return { ok: true }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to delete work item link.')
  } finally {
    release()
  }
}

export async function listWorkItemLinks(args: {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItemLink[]> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return []
  }
  await acquire()
  try {
    const response = await planeRequest<unknown>(
      client,
      linksPath(client, args.projectId, args.workItemId)
    )
    const rows = Array.isArray(response)
      ? response
      : Array.isArray((response as PlaneRecord)?.results)
        ? ((response as PlaneRecord).results as unknown[])
        : []
    return rows.map(mapLink)
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    console.warn('[plane] listWorkItemLinks failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}
