import type { PlaneCreateWorkItemArgs } from '../shared/plane-types'
import type { RuntimeClient } from './runtime-client'
import { getOptionalStringFlag, getRepeatedStringFlag, getRequiredStringFlag } from './flags'
import {
  getPlanePriorityFlag,
  readPlaneBody,
  rejectAllWorkspaceForPlaneWrite
} from './plane-request-builders'
import { resolveAssigneeIds, resolveStateId } from './plane-save-issue-request'

// Assembles the create payload for `orca plane create`, resolving --state
// (name/id) and --assignee me client-side against existing RPC reads. Only
// flags actually present become body fields so an omitted field stays absent.
export async function buildPlaneCreateRequest(
  flags: Map<string, string | boolean>,
  client: RuntimeClient,
  cwd: string
): Promise<PlaneCreateWorkItemArgs> {
  rejectAllWorkspaceForPlaneWrite(flags)
  const projectId = getRequiredStringFlag(flags, 'project')
  const title = getRequiredStringFlag(flags, 'title')
  const workspaceId = getOptionalStringFlag(flags, 'workspace')
  const request: PlaneCreateWorkItemArgs = { projectId, title, workspaceId }

  const description = await readPlaneBody(flags, cwd, { required: false })
  if (description !== undefined) {
    request.description = description
  }
  if (flags.has('state')) {
    request.stateId = await resolveStateId(flags, client, projectId, workspaceId)
  }
  if (flags.has('assignee')) {
    request.assigneeIds = await resolveAssigneeIds(flags, client, workspaceId)
  }
  if (flags.has('priority')) {
    request.priority = getPlanePriorityFlag(flags, 'priority')
  }
  if (flags.has('label')) {
    request.labelIds = getRepeatedStringFlag(flags, 'label')
  }
  return request
}
