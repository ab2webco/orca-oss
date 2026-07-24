import type { PlaneMutationResult } from '../../shared/plane-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import {
  rejectAllWorkspaceForPlaneWrite,
  resolvePlaneWriteTarget,
  throwOnPlaneMutationFailure
} from '../plane-request-builders'

const PLANE_WRITE_TIMEOUT_MS = 75_000

// Delete resolves the id/identifier to the work item UUID (Plane's write routes
// 404 on identifiers) before the destructive call; states delete targets a
// concrete state id directly (no identifier form).
export const PLANE_DELETE_ARCHIVE_HANDLERS: Record<string, CommandHandler> = {
  'plane delete': (ctx) => runWorkItemMutation(ctx, 'plane.deleteWorkItem', 'Deleted'),
  'plane states delete': async ({ flags, client, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const stateId = getRequiredStringFlag(flags, 'stateId')
    const response = await client.call<PlaneMutationResult>(
      'plane.deleteState',
      {
        projectId: getRequiredStringFlag(flags, 'project'),
        stateId,
        workspaceId: getOptionalStringFlag(flags, 'workspace')
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    throwOnPlaneMutationFailure(response.result)
    printResult(response, json, () => `Deleted column ${stateId}.`)
  }
}

async function runWorkItemMutation(
  ctx: HandlerContext,
  method: string,
  verb: string
): Promise<void> {
  const target = await resolvePlaneWriteTarget(ctx)
  const label = getOptionalStringFlag(ctx.flags, 'id') ?? target.workItemId
  const response = await ctx.client.call<PlaneMutationResult>(
    method,
    {
      projectId: target.projectId,
      workItemId: target.workItemId,
      workspaceId: target.workspaceId
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  throwOnPlaneMutationFailure(response.result)
  printResult(response, ctx.json, () => `${verb} ${label}.`)
}
