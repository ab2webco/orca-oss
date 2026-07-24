import type {
  PlaneLinkMutationResult,
  PlaneMutationResult,
  PlaneWorkItemLink
} from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import {
  resolvePlaneWriteTarget,
  throwOnPlaneMutationFailure,
  unwrapPlaneLinkMutation
} from '../plane-request-builders'
import { formatPlaneLinks } from '../plane-format'

const PLANE_WRITE_TIMEOUT_MS = 75_000

// URL links on a work item, exposed as `plane attach` so it never collides with
// the worktree-linking `plane link`. Each command resolves the id/identifier to
// the work item UUID first (Plane's write routes 404 on identifiers).
export const PLANE_ATTACH_HANDLERS: Record<string, CommandHandler> = {
  'plane attach add': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const title = getOptionalStringFlag(ctx.flags, 'title')
    const response = await ctx.client.call<PlaneLinkMutationResult>(
      'plane.addWorkItemLink',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        url: getRequiredStringFlag(ctx.flags, 'url'),
        title,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    const link = unwrapPlaneLinkMutation(response.result)
    printResult(
      { ...response, result: link },
      ctx.json,
      (value) => `Attached ${value.url} to ${target.workItemId}${value.id ? ` (${value.id})` : ''}.`
    )
  },
  'plane attach list': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const response = await ctx.client.call<PlaneWorkItemLink[]>('plane.listWorkItemLinks', {
      projectId: target.projectId,
      workItemId: target.workItemId,
      workspaceId: target.workspaceId
    })
    printResult(response, ctx.json, formatPlaneLinks)
  },
  'plane attach remove': async (ctx) => {
    const target = await resolvePlaneWriteTarget(ctx)
    const linkId = getRequiredStringFlag(ctx.flags, 'link')
    const response = await ctx.client.call<PlaneMutationResult>(
      'plane.deleteWorkItemLink',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        linkId,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    throwOnPlaneMutationFailure(response.result)
    printResult(response, ctx.json, () => `Removed link ${linkId} from ${target.workItemId}.`)
  }
}
