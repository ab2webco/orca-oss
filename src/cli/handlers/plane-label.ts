import type {
  PlaneLabelMutationResult,
  PlaneMutationResult,
  PlaneWorkItem
} from '../../shared/plane-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import {
  rejectAllWorkspaceForPlaneWrite,
  throwOnPlaneMutationFailure,
  unwrapPlaneLabelMutation
} from '../plane-request-builders'
import { formatPlaneLabelCreated } from '../plane-format'

const PLANE_WRITE_TIMEOUT_MS = 75_000

export const PLANE_LABEL_HANDLERS: Record<string, CommandHandler> = {
  'plane label create': async ({ flags, client, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const response = await client.call<PlaneLabelMutationResult>(
      'plane.createLabel',
      {
        projectId: getRequiredStringFlag(flags, 'project'),
        name: getRequiredStringFlag(flags, 'name'),
        color: getOptionalStringFlag(flags, 'color'),
        workspaceId: getOptionalStringFlag(flags, 'workspace')
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    const label = unwrapPlaneLabelMutation(response.result)
    printResult({ ...response, result: label }, json, formatPlaneLabelCreated)
  },
  'plane label add': (ctx) => runLabelEdit(ctx, 'add'),
  'plane label remove': (ctx) => runLabelEdit(ctx, 'remove')
}

// Incremental label edit: read the work item's current label ids, apply the
// add/remove delta, then PATCH the full label set. getWorkItem resolves the
// id/identifier to the UUID and returns labelIds in one round-trip.
async function runLabelEdit(ctx: HandlerContext, mode: 'add' | 'remove'): Promise<void> {
  const { flags, client, json } = ctx
  rejectAllWorkspaceForPlaneWrite(flags)
  const requestedId = getRequiredStringFlag(flags, 'id')
  const projectId = getRequiredStringFlag(flags, 'project')
  const workspaceId = getOptionalStringFlag(flags, 'workspace')
  const given = getRepeatedStringFlag(flags, 'label')
  if (given.length === 0) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --label')
  }
  const item = (
    await client.call<PlaneWorkItem | null>('plane.getWorkItem', {
      workItemId: requestedId,
      projectId,
      workspaceId
    })
  ).result
  if (!item) {
    throw new RuntimeClientError(
      'plane_work_item_not_found',
      `Plane work item ${requestedId} not found`
    )
  }
  const labelIds = new Set(item.labelIds ?? [])
  for (const id of given) {
    if (mode === 'add') {
      labelIds.add(id)
    } else {
      labelIds.delete(id)
    }
  }
  const response = await client.call<PlaneMutationResult>(
    'plane.updateWorkItem',
    {
      projectId,
      workItemId: item.id,
      workspaceId,
      updates: { labelIds: [...labelIds] }
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  throwOnPlaneMutationFailure(response.result)
  const verb = mode === 'add' ? 'Added labels to' : 'Removed labels from'
  printResult(response, json, () => `${verb} ${item.identifier}.`)
}
