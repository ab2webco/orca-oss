import type { PlaneComment } from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { resolvePlaneWriteTarget } from '../plane-request-builders'
import { formatPlaneComments } from '../plane-format'

// Lists a work item's comments. resolvePlaneWriteTarget resolves the
// id/identifier to the work item UUID (and rejects --workspace all), which the
// comments read needs to scope the request to a single item.
export const PLANE_COMMENT_LIST_HANDLERS: Record<string, CommandHandler> = {
  'plane comment list': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const response = await ctx.client.call<PlaneComment[]>('plane.listWorkItemComments', {
      projectId: target.projectId,
      workItemId: target.workItemId,
      workspaceId: target.workspaceId
    })
    printResult(response, ctx.json, formatPlaneComments)
  }
}
