import type { LinearErrorCode, LinearWorkspaceCandidate } from '../../shared/linear/agent-access'
import type { LinearWorkspace } from '../../shared/linear/workspace-types'
import { getClients, getStatus, type LinearClientForWorkspace } from './client'
import {
  LinearAgentAccessError,
  classifyLinearError,
  linearError,
  linearMessage
} from './issue-context-errors'

export type WorkspaceReadFailure = {
  workspace: LinearWorkspaceCandidate
  code: LinearErrorCode
  message: string
  error: LinearAgentAccessError
}

export async function getFanoutClientEntries(): Promise<{
  entries: LinearClientForWorkspace[]
  failures: WorkspaceReadFailure[]
}> {
  const workspaces = getStatus().workspaces ?? []
  if (workspaces.length === 0) {
    return { entries: await getClients('all'), failures: [] }
  }

  const entries: LinearClientForWorkspace[] = []
  const failures: WorkspaceReadFailure[] = []
  // Why: in parallel, so workspaces waiting on Keychain cost one bound, not one each.
  const reads = await Promise.allSettled(
    workspaces.map(async (workspace) => (await getClients(workspace.id))[0])
  )
  reads.forEach((read, index) => {
    if (read.status === 'fulfilled') {
      if (read.value) {
        entries.push(read.value)
      }
      return
    }
    failures.push(workspaceFailure(workspaces[index], toLinearAccessError(read.reason)))
    console.warn('[linear] agent workspace credential read failed:', read.reason)
  })
  return { entries, failures }
}

export function workspaceFailure(
  workspace: LinearWorkspace,
  error: LinearAgentAccessError
): WorkspaceReadFailure {
  return {
    workspace: {
      id: workspace.id,
      name: workspace.organizationName
    },
    code: error.code,
    message: error.message,
    error
  }
}

function toLinearAccessError(error: unknown): LinearAgentAccessError {
  if (error instanceof LinearAgentAccessError) {
    return error
  }
  return linearError(classifyLinearError(error), linearMessage(error))
}
