import type {
  PlaneMutationResult,
  PlaneRelationType,
  PlaneWorkItemRelation
} from '../../shared/plane-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import {
  resolvePlaneWorkItemUuid,
  resolvePlaneWriteTarget,
  throwOnPlaneMutationFailure
} from '../plane-request-builders'
import { formatPlaneRelations } from '../plane-format'

const PLANE_WRITE_TIMEOUT_MS = 75_000

// Friendlier CLI aliases mapped onto Plane's relation_type values.
const RELATION_TYPE_MAP: Record<string, PlaneRelationType> = {
  blocks: 'blocking',
  'blocked-by': 'blocked_by',
  related: 'relates_to',
  duplicate: 'duplicate'
}

function getRelationType(flags: Map<string, string | boolean>): PlaneRelationType {
  const raw = getRequiredStringFlag(flags, 'type').toLocaleLowerCase()
  const mapped = RELATION_TYPE_MAP[raw]
  if (!mapped) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--type must be blocks, blocked-by, related, or duplicate'
    )
  }
  return mapped
}

export const PLANE_RELATION_HANDLERS: Record<string, CommandHandler> = {
  'plane relation add': (ctx) =>
    runRelationMutation(ctx, 'plane.addWorkItemRelation', 'Added relation to'),
  'plane relation list': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const response = await ctx.client.call<PlaneWorkItemRelation[]>('plane.listWorkItemRelations', {
      projectId: target.projectId,
      workItemId: target.workItemId,
      workspaceId: target.workspaceId
    })
    printResult(response, ctx.json, formatPlaneRelations)
  }
}

async function runRelationMutation(
  ctx: HandlerContext,
  method: string,
  verb: string
): Promise<void> {
  const target = await resolvePlaneWriteTarget(ctx)
  const relationType = getRelationType(ctx.flags)
  const relatedWorkItemId = await resolvePlaneWorkItemUuid(
    ctx.client,
    getRequiredStringFlag(ctx.flags, 'related'),
    target.projectId,
    target.workspaceId
  )
  const response = await ctx.client.call<PlaneMutationResult>(
    method,
    {
      projectId: target.projectId,
      workItemId: target.workItemId,
      relationType,
      relatedWorkItemId,
      workspaceId: target.workspaceId
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  throwOnPlaneMutationFailure(response.result)
  printResult(response, ctx.json, () => `${verb} ${target.workItemId}.`)
}
