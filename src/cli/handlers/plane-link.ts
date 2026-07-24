import type {
  PlaneLinkCurrentWorkItemResult,
  PlaneUnlinkCurrentWorkItemResult
} from '../../shared/plane-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import {
  buildPlaneCurrentContext,
  rejectAllWorkspaceForPlaneWrite
} from '../plane-request-builders'
import { RuntimeClientError } from '../runtime-client'

const PLANE_WRITE_TIMEOUT_MS = 75_000

// Attaches a Plane work item to the worktree the command runs from. Unlike the
// `--current` readers, link always targets the current worktree and SETS the
// link; the id/project identify the Plane item to attach.
export const runPlaneLink: CommandHandler = async ({ flags, client, cwd, json }) => {
  rejectAllWorkspaceForPlaneWrite(flags)
  const identifier = getRequiredStringFlag(flags, 'id')
  const projectId = getRequiredStringFlag(flags, 'project')
  const workspaceId = getOptionalStringFlag(flags, 'workspace')
  const response = await client.call<PlaneLinkCurrentWorkItemResult>(
    'plane.linkCurrentWorkItem',
    {
      context: buildPlaneCurrentContext(cwd, client.isRemote),
      identifier,
      projectId,
      workspaceId
    },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  const result = response.result
  if (!result.ok) {
    throw linkFailureError(result.error, identifier)
  }
  printResult(
    { ...response, result: result.linked },
    json,
    (linked) => `Linked ${linked.identifier} to the current worktree.`
  )
}

// Clears the Plane link on the current worktree. Purely additive: leaves every
// other worktree link untouched.
export const runPlaneUnlink: CommandHandler = async ({ client, cwd, json }) => {
  const response = await client.call<PlaneUnlinkCurrentWorkItemResult>(
    'plane.unlinkCurrentWorkItem',
    { context: buildPlaneCurrentContext(cwd, client.isRemote) },
    { timeoutMs: PLANE_WRITE_TIMEOUT_MS }
  )
  const result = response.result
  if (!result.ok) {
    throw worktreeRequiredError('unlink')
  }
  printResult(response, json, () => 'Cleared the Plane link on the current worktree.')
}

function linkFailureError(
  error: 'no_worktree' | 'work_item_not_found',
  identifier: string
): RuntimeClientError {
  if (error === 'work_item_not_found') {
    return new RuntimeClientError(
      'plane_work_item_not_found',
      `Plane work item ${identifier} not found`
    )
  }
  return worktreeRequiredError('link')
}

function worktreeRequiredError(command: string): RuntimeClientError {
  return new RuntimeClientError(
    'plane_worktree_required',
    `Run ${command} from inside an Orca-managed worktree.`
  )
}
