import type {
  PlaneComment,
  PlaneLabel,
  PlaneMutationResult,
  PlaneProject,
  PlaneState,
  PlaneStateMutationResult,
  PlaneUser,
  PlaneWorkItem,
  PlaneWorkItemUpdate
} from '../../shared/plane-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import {
  getPlaneListFilter,
  getPlanePriorityFlag,
  getPlaneStateGroupFlag,
  readPlaneBody,
  rejectAllWorkspaceForPlaneWrite,
  resolvePlaneCurrentWorkItem,
  resolvePlaneStateId,
  resolvePlaneWriteTarget,
  throwOnPlaneMutationFailure,
  unwrapPlaneStateMutation,
  type PlaneWriteTarget
} from '../plane-request-builders'
import type { RuntimeRpcSuccess } from '../runtime-client'
import {
  formatPlaneLabels,
  formatPlaneList,
  formatPlaneMembers,
  formatPlaneProjectList,
  formatPlaneSearch,
  formatPlaneStateMutation,
  formatPlaneStates,
  formatPlaneWorkItem,
  type PlaneIssueView
} from '../plane-format'
import { resolveViewerId } from '../plane-save-issue-request'
import { runPlaneCreate } from './plane-create'
import { runPlaneLink, runPlaneUnlink } from './plane-link'
import { runPlaneSaveIssue } from './plane-save-issue'

const PLANE_WRITE_TIMEOUT_MS = 75_000

export const PLANE_HANDLERS: Record<string, CommandHandler> = {
  'plane create': runPlaneCreate,
  'plane link': runPlaneLink,
  'plane unlink': runPlaneUnlink,
  'plane save-issue': runPlaneSaveIssue,
  'plane issue': async ({ flags, client, cwd, json }) => {
    const explicitId = getOptionalStringFlag(flags, 'id')
    const current = flags.get('current') === true
    if (explicitId && current) {
      throw new RuntimeClientError('invalid_argument', 'Pass either <id> or --current, not both')
    }
    const workspaceId = getOptionalStringFlag(flags, 'workspace')
    let response: RuntimeRpcSuccess<PlaneWorkItem | null>
    let label: string
    if (current) {
      // Why: resolveCurrentWorkItem already fetched the item, so reuse it rather
      // than issuing a second getWorkItem round-trip.
      const resolved = await resolvePlaneCurrentWorkItem(client, cwd)
      response = { ...resolved, result: resolved.result.workItem }
      label = resolved.result.identifier
    } else {
      label = getRequiredStringFlag(flags, 'id')
      response = await client.call<PlaneWorkItem | null>('plane.getWorkItem', {
        workItemId: label,
        projectId: getOptionalStringFlag(flags, 'project'),
        workspaceId
      })
    }
    const workItem = response.result
    if (!workItem) {
      throw new RuntimeClientError(
        'plane_work_item_not_found',
        `Plane work item ${label} not found`
      )
    }
    const view: PlaneIssueView = { workItem }
    if (flags.get('children') === true) {
      // Why: Plane has no "get children" route and the self-hosted REST ignores
      // pql, so fetch the project's items and keep the direct sub-issues — lets
      // an agent read "how is this epic going?" without a separate list + filter.
      const siblings = await client.call<PlaneWorkItem[]>('plane.listWorkItems', {
        projectId: workItem.project.id,
        filter: 'everything',
        workspaceId
      })
      view.children = siblings.result.filter((child) => child.parentId === workItem.id)
    }
    if (flags.get('comments') === true) {
      const comments = await client.call<PlaneComment[]>('plane.listWorkItemComments', {
        projectId: workItem.project.id,
        workItemId: workItem.id,
        workspaceId
      })
      view.comments = comments.result
    }
    printResult({ ...response, result: view }, json, formatPlaneWorkItem)
  },
  'plane list': async ({ flags, client, json }) => {
    const response = await client.call<PlaneWorkItem[]>('plane.listWorkItems', {
      projectId: getOptionalStringFlag(flags, 'project'),
      filter: getPlaneListFilter(flags),
      workspaceId: getOptionalStringFlag(flags, 'workspace')
    })
    const limit = getOptionalPositiveIntegerFlag(flags, 'limit')
    // Why: --state/--priority filter client-side because the self-hosted REST v1
    // ignores server-side pql (see plane-pql-filter); state matches on name,
    // priority on the static enum, both case-insensitive.
    const stateFilter = getOptionalStringFlag(flags, 'state')?.toLowerCase()
    const priorityFilter = getOptionalStringFlag(flags, 'priority')?.toLowerCase()
    const filtered = response.result.filter(
      (item) =>
        (stateFilter === undefined || item.state.name.toLowerCase() === stateFilter) &&
        (priorityFilter === undefined || (item.priority ?? 'none').toLowerCase() === priorityFilter)
    )
    const items = limit === undefined ? filtered : filtered.slice(0, limit)
    printResult({ ...response, result: items }, json, formatPlaneList)
  },
  'plane search': async ({ flags, client, json }) => {
    const response = await client.call<PlaneWorkItem[]>('plane.searchWorkItems', {
      query: getRequiredStringFlag(flags, 'query'),
      projectId: getOptionalStringFlag(flags, 'project'),
      workspaceId: getOptionalStringFlag(flags, 'workspace')
    })
    printResult(response, json, formatPlaneSearch)
  },
  'plane status set': async (ctx) => {
    const { flags, client } = ctx
    const target = await planeWriteTarget(ctx)
    const states = await client.call<PlaneState[]>('plane.listStates', {
      projectId: target.projectId,
      workspaceId: target.workspaceId
    })
    const stateId = resolvePlaneStateId(states.result, getRequiredStringFlag(flags, 'to'))
    await runPlaneUpdate(ctx, target, { stateId }, `Set ${target.workItemId} state.`)
  },
  'plane assignee set': async (ctx) => {
    const target = await planeWriteTarget(ctx)
    const assigneeIds = await resolveAssigneeSet(ctx, target.workspaceId)
    await runPlaneUpdate(ctx, target, { assigneeIds }, `Updated ${target.workItemId} assignee.`)
  },
  'plane assignee clear': async (ctx) => {
    const target = await planeWriteTarget(ctx)
    await runPlaneUpdate(ctx, target, { assigneeIds: [] }, `Cleared ${target.workItemId} assignee.`)
  },
  'plane priority set': async (ctx) => {
    const target = await planeWriteTarget(ctx)
    const priority = getPlanePriorityFlag(ctx.flags, 'to')
    await runPlaneUpdate(
      ctx,
      target,
      { priority },
      `Set ${target.workItemId} priority ${priority}.`
    )
  },
  'plane priority clear': async (ctx) => {
    const target = await planeWriteTarget(ctx)
    await runPlaneUpdate(
      ctx,
      target,
      { priority: 'none' },
      `Cleared ${target.workItemId} priority.`
    )
  },
  'plane comment add': async (ctx) => {
    const { flags, client, cwd, json } = ctx
    const target = await planeWriteTarget(ctx)
    const body = await readPlaneBody(flags, cwd, { required: true })
    const response = await client.call<PlaneMutationResult>(
      'plane.addWorkItemComment',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        body,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    throwOnPlaneMutationFailure(response.result)
    printResult(response, json, () => `Added comment to ${target.workItemId}.`)
  },
  'plane comment delete': async (ctx) => {
    const { client, json } = ctx
    const commentId = getRequiredStringFlag(ctx.flags, 'commentId')
    const target = await planeWriteTarget(ctx)
    const response = await client.call<PlaneMutationResult>(
      'plane.deleteWorkItemComment',
      {
        projectId: target.projectId,
        workItemId: target.workItemId,
        commentId,
        workspaceId: target.workspaceId
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    throwOnPlaneMutationFailure(response.result)
    printResult(response, json, () => `Deleted comment ${commentId} from ${target.workItemId}.`)
  },
  'plane project list': async ({ flags, client, json }) => {
    // Why: defaulting to the host's selected workspace made the answer depend on
    // mutable app state, so identical calls listed a different workspace each
    // time; 'all' is the deterministic default and stays grouped (ORCA-139).
    const response = await client.call<PlaneProject[]>('plane.listProjects', {
      workspaceId: getOptionalStringFlag(flags, 'workspace') ?? 'all'
    })
    printResult(response, json, formatPlaneProjectList)
  },
  'plane states list': async ({ flags, client, json }) => {
    const response = await client.call<PlaneState[]>('plane.listStates', {
      projectId: getRequiredStringFlag(flags, 'project'),
      workspaceId: getOptionalStringFlag(flags, 'workspace')
    })
    printResult(response, json, formatPlaneStates)
  },
  'plane states create': async ({ flags, client, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const response = await client.call<PlaneStateMutationResult>(
      'plane.createState',
      {
        projectId: getRequiredStringFlag(flags, 'project'),
        workspaceId: getOptionalStringFlag(flags, 'workspace'),
        name: getRequiredStringFlag(flags, 'name'),
        group: getPlaneStateGroupFlag(flags, 'group'),
        color: getOptionalStringFlag(flags, 'color')
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    const state = unwrapPlaneStateMutation(response.result)
    printResult({ ...response, result: state }, json, formatPlaneStateMutation)
  },
  'plane states rename': async ({ flags, client, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const response = await client.call<PlaneStateMutationResult>(
      'plane.updateState',
      {
        projectId: getRequiredStringFlag(flags, 'project'),
        stateId: getRequiredStringFlag(flags, 'state'),
        workspaceId: getOptionalStringFlag(flags, 'workspace'),
        name: getRequiredStringFlag(flags, 'name'),
        color: getOptionalStringFlag(flags, 'color')
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    const state = unwrapPlaneStateMutation(response.result)
    printResult({ ...response, result: state }, json, formatPlaneStateMutation)
  },
  'plane labels list': async ({ flags, client, json }) => {
    const response = await client.call<PlaneLabel[]>('plane.listLabels', {
      projectId: getRequiredStringFlag(flags, 'project'),
      workspaceId: getOptionalStringFlag(flags, 'workspace')
    })
    printResult(response, json, formatPlaneLabels)
  },
  'plane members list': async ({ flags, client, json }) => {
    const response = await client.call<PlaneUser[]>('plane.listMembers', {
      workspaceId: getOptionalStringFlag(flags, 'workspace'),
      projectId: getOptionalStringFlag(flags, 'project')
    })
    printResult(response, json, formatPlaneMembers)
  }
}

function planeWriteTarget({ flags, client, cwd }: HandlerContext): Promise<PlaneWriteTarget> {
  return resolvePlaneWriteTarget({ flags, client, cwd })
}

async function resolveAssigneeSet(
  { flags, client }: HandlerContext,
  workspaceId: string | undefined
): Promise<string[]> {
  const me = flags.get('me') === true
  const toId = getOptionalStringFlag(flags, 'to-id')
  if (me === Boolean(toId)) {
    throw new RuntimeClientError('invalid_argument', 'Pass exactly one of --me or --to-id')
  }
  return me ? [await resolveViewerId(client, workspaceId)] : [toId as string]
}

async function runPlaneUpdate(
  { client, json }: HandlerContext,
  target: PlaneWriteTarget,
  updates: PlaneWorkItemUpdate,
  message: string
): Promise<void> {
  const response = await client.call<PlaneMutationResult>(
    'plane.updateWorkItem',
    {
      projectId: target.projectId,
      workItemId: target.workItemId,
      workspaceId: target.workspaceId,
      updates
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  throwOnPlaneMutationFailure(response.result)
  printResult(response, json, () => message)
}
