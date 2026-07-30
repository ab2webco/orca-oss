import type {
  PlaneMutationResult,
  PlaneProject,
  PlaneProjectMutationResult
} from '../../shared/plane-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getPresentStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'
import {
  rejectAllWorkspaceForPlaneWrite,
  throwOnPlaneMutationFailure
} from '../plane-request-builders'
import { formatPlaneProjectMutation } from '../plane-format'

const PLANE_WRITE_TIMEOUT_MS = 75_000

// Project writes are workspace-scoped, so --workspace here takes a slug or a
// saved workspace id (project list only ever printed the slug). Credentials come
// from the connection Orca already manages; nothing accepts an API key.
export const PLANE_PROJECT_HANDLERS: Record<string, CommandHandler> = {
  'plane project create': async ({ flags, client, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const response = await client.call<PlaneProjectMutationResult>(
      'plane.createProject',
      {
        name: getRequiredStringFlag(flags, 'name'),
        identifier: getRequiredStringFlag(flags, 'identifier'),
        description: getOptionalStringFlag(flags, 'description'),
        workspace: getOptionalStringFlag(flags, 'workspace')
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    printProject(response, json)
  },
  'plane project update': async ({ flags, client, json }) => {
    rejectAllWorkspaceForPlaneWrite(flags)
    const name = getOptionalStringFlag(flags, 'name')
    const identifier = getOptionalStringFlag(flags, 'identifier')
    // allowEmpty: --description "" is how a description gets cleared.
    const description = getPresentStringFlag(flags, 'description', { allowEmpty: true })
    if (name === undefined && identifier === undefined && description === undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass at least one of --name, --identifier, or --description'
      )
    }
    const response = await client.call<PlaneProjectMutationResult>(
      'plane.updateProject',
      {
        projectId: getRequiredStringFlag(flags, 'project'),
        name,
        identifier,
        description,
        workspace: getOptionalStringFlag(flags, 'workspace')
      },
      { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
    )
    printProject(response, json)
  },
  'plane project archive': (ctx) => runArchive(ctx, true),
  'plane project unarchive': (ctx) => runArchive(ctx, false)
}

function printProject(
  response: RuntimeRpcSuccess<PlaneProjectMutationResult>,
  json: boolean
): void {
  if (!response.result.ok) {
    throw new RuntimeClientError('plane_write_failed', response.result.error)
  }
  const project: PlaneProject = response.result.project
  printResult({ ...response, result: project }, json, formatPlaneProjectMutation)
}

async function runArchive(
  { flags, client, json }: HandlerContext,
  archived: boolean
): Promise<void> {
  rejectAllWorkspaceForPlaneWrite(flags)
  const projectId = getRequiredStringFlag(flags, 'project')
  const response = await client.call<PlaneMutationResult>(
    'plane.setProjectArchived',
    {
      projectId,
      archived,
      workspace: getOptionalStringFlag(flags, 'workspace')
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  throwOnPlaneMutationFailure(response.result)
  printResult(response, json, () =>
    archived ? `Archived project ${projectId}.` : `Unarchived project ${projectId}.`
  )
}
