import {
  linearGetIssue,
  linearTeamStates,
  linearUpdateIssue,
  type LinearMutationResult
} from '@/runtime/runtime-linear-client'
import type {
  GlobalSettings,
  LinearIssue,
  LinearWorkflowState,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import { isSameStateName, matchStatesByLabel } from './workspace-board-status-label-match'
import {
  emptyStatusSyncResult,
  failed,
  skipped,
  type WorkspaceBoardTaskStatusSyncResult
} from './workspace-board-task-status-sync-result'

export type LinearStatusWriteDependencies = {
  getIssue: typeof linearGetIssue
  teamStates: typeof linearTeamStates
  updateIssue: typeof linearUpdateIssue
}

export const defaultLinearStatusWriteDependencies: LinearStatusWriteDependencies = {
  getIssue: linearGetIssue,
  teamStates: linearTeamStates,
  updateIssue: linearUpdateIssue
}

export type LinearStatusWriteArgs = {
  issueIdentifier: string
  linkedWorkspaceId?: string
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  targetStatus: WorkspaceStatusDefinition
  /** False once a newer board move has already replaced this target locally. */
  isStillTargetStatus: () => boolean
  deps: LinearStatusWriteDependencies
}

function isAlreadyInState(issue: LinearIssue, workflowState: LinearWorkflowState): boolean {
  return (
    isSameStateName(issue.state.name, workflowState.name) && issue.state.type === workflowState.type
  )
}

export async function writeLinearWorkspaceStatus(
  args: LinearStatusWriteArgs
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const result = emptyStatusSyncResult()

  try {
    const issue = await args.deps.getIssue(
      args.settings,
      args.issueIdentifier,
      args.linkedWorkspaceId
    )
    if (!issue?.team?.id) {
      return skipped(result, {
        kind: 'issue-read-failed',
        provider: 'linear',
        issueIdentifier: args.issueIdentifier
      })
    }

    const workspaceId = args.linkedWorkspaceId ?? issue.workspaceId
    const states = await args.deps.teamStates(args.settings, issue.team.id, workspaceId)
    const matches = matchStatesByLabel(states, args.targetStatus.label)
    if (matches.length === 0) {
      return skipped(result, {
        kind: 'missing-workflow-state',
        provider: 'linear',
        statusLabel: args.targetStatus.label
      })
    }
    if (matches.length > 1) {
      return skipped(result, {
        kind: 'ambiguous-workflow-state',
        provider: 'linear',
        statusLabel: args.targetStatus.label
      })
    }

    const [workflowState] = matches
    if (isAlreadyInState(issue, workflowState)) {
      return skipped(result)
    }

    // Why: board moves are local-first; slow provider reads must not let an
    // older board move overwrite a newer local status in Linear.
    if (!args.isStillTargetStatus()) {
      return skipped(result)
    }

    const updateResult: LinearMutationResult = await args.deps.updateIssue(
      args.settings,
      issue.id,
      { stateId: workflowState.id },
      workspaceId
    )
    if (updateResult.ok === false) {
      return failed(result, {
        kind: 'update-failed',
        provider: 'linear',
        issueIdentifier: issue.identifier,
        detail: updateResult.error
      })
    }
    result.updated += 1
    return result
  } catch (error) {
    return failed(result, {
      kind: 'provider-error',
      provider: 'linear',
      issueIdentifier: args.issueIdentifier,
      detail: error instanceof Error ? error.message : undefined
    })
  }
}
