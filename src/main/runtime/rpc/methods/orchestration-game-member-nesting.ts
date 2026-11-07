import type { OrcaRuntimeService } from '../../orca-runtime'
import type { WorkerStartInput } from './orchestration-worker-start-schema'
import type { WorkerEffect } from './orchestration-worker-topology'

/** Nests a game member's worktree under its lead's, or reports why not; never fails the start. */
export async function nestGameMember(args: {
  runtime: OrcaRuntimeService
  params: WorkerStartInput
  task: { id: string }
  run: { id: string }
  topology: { coordinatorWorktreeId: string }
  resolvedWorktree: { id: string }
  effects: WorkerEffect[]
}): Promise<void> {
  if (!args.params.game) {
    return
  }
  const memberWorktreeId = args.resolvedWorktree.id
  const reason = await args.runtime
    .nestGameMemberWorktree(memberWorktreeId, args.topology.coordinatorWorktreeId, {
      taskId: args.task.id,
      runId: args.run.id,
      coordinatorHandle: args.params.from
    })
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
  if (reason) {
    args.effects.push({
      kind: 'worktree',
      action: 'lineage_unresolved',
      id: memberWorktreeId,
      warning: `Not nested under the lead's worktree: ${reason}`
    })
  }
}
