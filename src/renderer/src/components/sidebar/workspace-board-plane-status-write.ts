import {
  planeGetWorkItem,
  planeListStates,
  planeUpdateWorkItem
} from '@/runtime/runtime-plane-client'
import type { PlaneMutationResult } from '../../../../shared/plane-types'
import type {
  GlobalSettings,
  LinkedPlaneWorkItem,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import { matchStatesByLabel } from './workspace-board-status-label-match'
import {
  emptyStatusSyncResult,
  failed,
  skipped,
  type WorkspaceBoardTaskStatusSyncResult
} from './workspace-board-task-status-sync-result'

export type PlaneStatusWriteDependencies = {
  getWorkItem: typeof planeGetWorkItem
  listStates: typeof planeListStates
  updateWorkItem: typeof planeUpdateWorkItem
}

export const defaultPlaneStatusWriteDependencies: PlaneStatusWriteDependencies = {
  getWorkItem: planeGetWorkItem,
  listStates: planeListStates,
  updateWorkItem: planeUpdateWorkItem
}

export type PlaneStatusWriteArgs = {
  link: LinkedPlaneWorkItem
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  targetStatus: WorkspaceStatusDefinition
  /** False once a newer board move has already replaced this target locally. */
  isStillTargetStatus: () => boolean
  deps: PlaneStatusWriteDependencies
}

export async function writePlaneWorkspaceStatus(
  args: PlaneStatusWriteArgs
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const result = emptyStatusSyncResult()

  try {
    const workItem = await args.deps.getWorkItem(
      args.settings,
      args.link.identifier,
      args.link.projectId,
      args.link.workspaceId
    )
    if (!workItem) {
      return skipped(result, {
        kind: 'issue-read-failed',
        provider: 'plane',
        issueIdentifier: args.link.identifier
      })
    }

    // Plane states are per project, so the mapping can only be resolved against
    // the project that actually owns this work item — never a table in code.
    const projectId = args.link.projectId || workItem.project.id
    const workspaceId = args.link.workspaceId ?? workItem.workspaceId
    const states = await args.deps.listStates(args.settings, projectId, workspaceId)
    const matches = matchStatesByLabel(states, args.targetStatus.label)
    if (matches.length === 0) {
      // Why: a board column with no equivalent state in this project is a real
      // gap the user has to resolve in Plane; creating the state for them would
      // be an unrequested write, so this surfaces instead.
      return skipped(result, {
        kind: 'missing-workflow-state',
        provider: 'plane',
        statusLabel: args.targetStatus.label
      })
    }
    if (matches.length > 1) {
      return skipped(result, {
        kind: 'ambiguous-workflow-state',
        provider: 'plane',
        statusLabel: args.targetStatus.label
      })
    }

    const [planeState] = matches
    if (workItem.state.id === planeState.id) {
      return skipped(result)
    }

    // Why: board moves are local-first; slow provider reads must not let an
    // older board move overwrite a newer local status in Plane.
    if (!args.isStillTargetStatus()) {
      return skipped(result)
    }

    const updateResult: PlaneMutationResult = await args.deps.updateWorkItem(
      args.settings,
      projectId,
      workItem.id,
      { stateId: planeState.id },
      workspaceId
    )
    if (updateResult.ok === false) {
      return failed(result, {
        kind: 'update-failed',
        provider: 'plane',
        issueIdentifier: workItem.identifier,
        detail: updateResult.error
      })
    }
    result.updated += 1
    return result
  } catch (error) {
    return failed(result, {
      kind: 'provider-error',
      provider: 'plane',
      issueIdentifier: args.link.identifier,
      detail: error instanceof Error ? error.message : undefined
    })
  }
}
