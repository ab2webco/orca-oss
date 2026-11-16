import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { TeamSessionRef } from '../../../../shared/team-panel-model-types'

/** A remote card whose host worktree this window does not hold: revealing its terminal can only fail. */
export function teamHostWorktreeMissing(
  ref: Pick<TeamSessionRef, 'host' | 'worktreeId'>,
  known: (worktreeId: string, executionHostId: ExecutionHostId) => unknown
): boolean {
  if (ref.host.kind !== 'remote' || !ref.host.environmentId || !ref.worktreeId) {
    return false
  }
  return !known(ref.worktreeId, toRuntimeExecutionHostId(ref.host.environmentId))
}
