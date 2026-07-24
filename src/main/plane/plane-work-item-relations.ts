// Plane work-item relations: create and list (project-scoped, nested under the
// work item's `/relations/` sub-route). Split from the write surface to stay
// under the oxlint max-lines cap without a suppression; reuses the shared
// client resolver + error mapper and work-items.ts's path builder.
//
// Endpoint shapes are assumed against Plane REST v1 and mirror the Plane MCP
// (create takes relation_type + issues[]; list groups related items by
// relation_type) — verify against a live tenant.
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
  PlaneAddRelationArgs,
  PlaneMutationResult,
  PlaneRelationType,
  PlaneWorkItemRelation,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

const RELATION_TYPES: readonly PlaneRelationType[] = [
  'relates_to',
  'blocking',
  'blocked_by',
  'duplicate',
  'start_after',
  'start_before',
  'finish_after',
  'finish_before'
]

function relationsPath(
  client: PlaneClientForWorkspace,
  projectId: string,
  workItemId: string
): string {
  return `${workItemsBase(client, projectId)}${encodeURIComponent(workItemId)}/relations/`
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

// Related entries arrive grouped by relation_type; each entry is best-effort
// mapped from either the related work item record or a relation wrapper.
function mapRelationEntry(raw: unknown, relationType: PlaneRelationType): PlaneWorkItemRelation {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as PlaneRecord
  // Plane groups relations by type; each entry is { project_id, issue_id } where
  // issue_id is the related work item's UUID (fall back to older shapes).
  const relatedWorkItemId =
    asString(entry.issue_id) || asString(entry.related_issue) || asString(entry.id)
  return {
    id: asString(entry.id) || relatedWorkItemId,
    relationType,
    relatedWorkItemId,
    name: asString(entry.name) || undefined,
    sequenceId: typeof entry.sequence_id === 'number' ? entry.sequence_id : undefined
  }
}

export async function addWorkItemRelation(
  args: PlaneAddRelationArgs
): Promise<PlaneMutationResult> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: 'Not connected to Plane.' }
  }
  await acquire()
  try {
    await planeRequest(client, relationsPath(client, args.projectId, args.workItemId), {
      method: 'POST',
      body: JSON.stringify({
        relation_type: args.relationType,
        issues: [args.relatedWorkItemId]
      })
    })
    return { ok: true }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to add work item relation.')
  } finally {
    release()
  }
}

export async function listWorkItemRelations(args: {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}): Promise<PlaneWorkItemRelation[]> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return []
  }
  await acquire()
  try {
    const grouped = await planeRequest<PlaneRecord>(
      client,
      relationsPath(client, args.projectId, args.workItemId)
    )
    const relations: PlaneWorkItemRelation[] = []
    for (const relationType of RELATION_TYPES) {
      const bucket = grouped[relationType]
      if (Array.isArray(bucket)) {
        for (const entry of bucket) {
          relations.push(mapRelationEntry(entry, relationType))
        }
      }
    }
    return relations
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    console.warn('[plane] listWorkItemRelations failed:', boundedIntegrationErrorLog(error))
    return []
  } finally {
    release()
  }
}
