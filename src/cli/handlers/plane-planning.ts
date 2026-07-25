import type {
  PlaneMutationResult,
  PlanePlanningContainer,
  PlanePlanningKind,
  PlanePlanningWorkItem
} from '../../shared/plane-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  rejectAllWorkspaceForPlaneWrite,
  throwOnPlaneMutationFailure
} from '../plane-request-builders'

const PLANE_WRITE_TIMEOUT_MS = 75_000

function formatContainers(containers: PlanePlanningContainer[]): string {
  if (containers.length === 0) {
    return 'No Plane planning containers found.'
  }
  return containers
    .map((container) => `${container.name.padEnd(28)} ${container.status ?? '-'} ${container.id}`)
    .join('\n')
}

function formatWorkItems(items: PlanePlanningWorkItem[]): string {
  if (items.length === 0) {
    return 'No work items found.'
  }
  return items
    .map((item) => `${(item.identifier ?? item.workItemId).padEnd(28)} ${item.title ?? ''}`)
    .join('\n')
}

function containerId(ctx: HandlerContext, kind: PlanePlanningKind): string {
  return getRequiredStringFlag(ctx.flags, `${kind}Id`)
}

async function listContainers(ctx: HandlerContext, kind: PlanePlanningKind): Promise<void> {
  const response = await ctx.client.call<PlanePlanningContainer[]>('plane.listPlanningContainers', {
    kind,
    projectId: getRequiredStringFlag(ctx.flags, 'project'),
    workspaceId: getOptionalStringFlag(ctx.flags, 'workspace')
  })
  printResult(response, ctx.json, formatContainers)
}

async function listWorkItems(ctx: HandlerContext, kind: PlanePlanningKind): Promise<void> {
  const response = await ctx.client.call<PlanePlanningWorkItem[]>('plane.listPlanningWorkItems', {
    kind,
    projectId: getRequiredStringFlag(ctx.flags, 'project'),
    containerId: containerId(ctx, kind),
    workspaceId: getOptionalStringFlag(ctx.flags, 'workspace')
  })
  printResult(response, ctx.json, formatWorkItems)
}

async function addWorkItems(ctx: HandlerContext, kind: PlanePlanningKind): Promise<void> {
  rejectAllWorkspaceForPlaneWrite(ctx.flags)
  const workItemIds = getRepeatedStringFlag(ctx.flags, 'item')
  if (workItemIds.length === 0) {
    throw new RuntimeClientError('invalid_argument', 'Pass at least one --item <workItemId>')
  }
  const targetId = containerId(ctx, kind)
  const response = await ctx.client.call<PlaneMutationResult>(
    'plane.addPlanningWorkItems',
    {
      kind,
      projectId: getRequiredStringFlag(ctx.flags, 'project'),
      containerId: targetId,
      workItemIds,
      workspaceId: getOptionalStringFlag(ctx.flags, 'workspace')
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  throwOnPlaneMutationFailure(response.result)
  printResult(
    response,
    ctx.json,
    () => `Added ${workItemIds.length} work item(s) to ${kind} ${targetId}.`
  )
}

export const PLANE_PLANNING_HANDLERS: Record<string, CommandHandler> = {
  'plane cycle list': (ctx) => listContainers(ctx, 'cycle'),
  'plane cycle issues': (ctx) => listWorkItems(ctx, 'cycle'),
  'plane cycle add-items': (ctx) => addWorkItems(ctx, 'cycle'),
  'plane module list': (ctx) => listContainers(ctx, 'module'),
  'plane module issues': (ctx) => listWorkItems(ctx, 'module'),
  'plane module add-items': (ctx) => addWorkItems(ctx, 'module')
}
