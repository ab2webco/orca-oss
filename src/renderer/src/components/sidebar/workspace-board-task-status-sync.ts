import type {
  GlobalSettings,
  WorkspaceStatus,
  WorkspaceStatusDefinition,
  Worktree
} from '../../../../shared/types'
import { getWorkspaceStatus } from '../../../../shared/workspace-statuses'
import {
  defaultLinearStatusWriteDependencies,
  writeLinearWorkspaceStatus,
  type LinearStatusWriteDependencies
} from './workspace-board-linear-status-write'
import {
  defaultPlaneStatusWriteDependencies,
  writePlaneWorkspaceStatus,
  type PlaneStatusWriteDependencies
} from './workspace-board-plane-status-write'
import {
  emptyStatusSyncResult,
  mergeResult,
  skipped,
  type WorkspaceBoardTaskStatusSyncResult
} from './workspace-board-task-status-sync-result'

export type {
  WorkspaceBoardTaskStatusSyncMessage,
  WorkspaceBoardTaskStatusSyncProvider,
  WorkspaceBoardTaskStatusSyncResult
} from './workspace-board-task-status-sync-result'

export type WorkspaceBoardTaskStatusSyncDependencies = LinearStatusWriteDependencies &
  PlaneStatusWriteDependencies

type SyncedWorktreeLinks = Pick<
  Worktree,
  'linkedLinearIssue' | 'linkedLinearIssueWorkspaceId' | 'linkedPlaneWorkItem'
>

export type SyncWorkspaceBoardTaskStatusesArgs = {
  worktreeIds: readonly string[]
  targetStatus: WorkspaceStatusDefinition
  worktreesById: ReadonlyMap<string, SyncedWorktreeLinks>
  settings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
  getSettingsForWorktree?: (
    worktreeId: string
  ) => Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
  getLatestWorkspaceStatus: (worktreeId: string) => WorkspaceStatus | null | undefined
  deps?: Partial<WorkspaceBoardTaskStatusSyncDependencies>
}

export type WorkspaceBoardTaskStatusSyncRequest = {
  worktreeIds: string[]
  targetStatus: WorkspaceStatusDefinition
}

export function getWorkspaceBoardTaskStatusSyncRequest(args: {
  enabled: boolean
  worktreeIds: readonly string[]
  status: WorkspaceStatus
  worktreesById: ReadonlyMap<string, Pick<Worktree, 'workspaceStatus'>>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}): WorkspaceBoardTaskStatusSyncRequest | null {
  if (!args.enabled || args.worktreeIds.length === 0) {
    return null
  }
  const targetStatus = args.workspaceStatuses.find((item) => item.id === args.status)
  if (!targetStatus) {
    return null
  }
  const changedWorktreeIds = [...new Set(args.worktreeIds)].filter((worktreeId) => {
    const worktree = args.worktreesById.get(worktreeId)
    return worktree ? getWorkspaceStatus(worktree, args.workspaceStatuses) !== args.status : false
  })
  if (changedWorktreeIds.length === 0) {
    return null
  }
  return { worktreeIds: changedWorktreeIds, targetStatus }
}

const defaultDeps: WorkspaceBoardTaskStatusSyncDependencies = {
  ...defaultLinearStatusWriteDependencies,
  ...defaultPlaneStatusWriteDependencies
}

const worktreeSyncQueues = new Map<string, Promise<unknown>>()

async function enqueueWorktreeSync(
  worktreeId: string,
  task: () => Promise<WorkspaceBoardTaskStatusSyncResult>
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const previous = worktreeSyncQueues.get(worktreeId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  const cleanup = next.finally(() => {
    if (worktreeSyncQueues.get(worktreeId) === cleanup) {
      worktreeSyncQueues.delete(worktreeId)
    }
  })
  worktreeSyncQueues.set(worktreeId, cleanup)
  return next
}

// Why: both links are explicit user choices. Writing only one would drop the
// other without a trace, which is the failure this sync exists to avoid.
async function syncWorktreeStatus(
  args: SyncWorkspaceBoardTaskStatusesArgs,
  worktreeId: string,
  deps: WorkspaceBoardTaskStatusSyncDependencies
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const aggregate = emptyStatusSyncResult()
  const worktree = args.worktreesById.get(worktreeId)
  const linearIssue = worktree?.linkedLinearIssue ?? null
  const planeLink = worktree?.linkedPlaneWorkItem ?? null
  if (!linearIssue && !planeLink) {
    return skipped(aggregate)
  }

  const settings = args.getSettingsForWorktree
    ? args.getSettingsForWorktree(worktreeId)
    : args.settings
  const isStillTargetStatus = (): boolean =>
    args.getLatestWorkspaceStatus(worktreeId) === args.targetStatus.id

  if (linearIssue) {
    mergeResult(
      aggregate,
      await writeLinearWorkspaceStatus({
        issueIdentifier: linearIssue,
        linkedWorkspaceId: worktree?.linkedLinearIssueWorkspaceId ?? undefined,
        settings,
        targetStatus: args.targetStatus,
        isStillTargetStatus,
        deps
      })
    )
  }
  if (planeLink) {
    mergeResult(
      aggregate,
      await writePlaneWorkspaceStatus({
        link: planeLink,
        settings,
        targetStatus: args.targetStatus,
        isStillTargetStatus,
        deps
      })
    )
  }
  return aggregate
}

export async function syncWorkspaceBoardTaskStatuses(
  args: SyncWorkspaceBoardTaskStatusesArgs
): Promise<WorkspaceBoardTaskStatusSyncResult> {
  const deps = { ...defaultDeps, ...args.deps }
  const aggregate = emptyStatusSyncResult()

  const uniqueIds = new Set(args.worktreeIds)
  await Promise.all(
    [...uniqueIds].map(async (worktreeId) => {
      const item = await enqueueWorktreeSync(worktreeId, () =>
        syncWorktreeStatus(args, worktreeId, deps)
      )
      mergeResult(aggregate, item)
    })
  )

  return aggregate
}
