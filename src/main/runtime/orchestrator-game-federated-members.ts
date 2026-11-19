import type { OrchestrationDb } from './orchestration/db'
import type { RemoteHostSessions } from './orchestrator-game-remote-found'

type OpenFederatedDispatch = ReturnType<OrchestrationDb['listOpenFederatedDispatches']>[number]

/** A member this Orca placed on a paired host that runs there now, whatever Run placed it (ORCA-1284). */
export type FederatedGameMember = {
  dispatchId: string
  host: string
  leadWorktreeId: string | null
}

/**
 * The open dispatches whose host worktree runs an agent in the host's latest `worktree.ps` read.
 * Why not the DB alone: a host keeps only an attachment and the lead's rows are never closed.
 */
export function liveFederatedGameMembersOf(
  dispatches: readonly OpenFederatedDispatch[],
  hosts: readonly RemoteHostSessions[]
): FederatedGameMember[] {
  return dispatches.flatMap(({ dispatchId, environmentId, remoteWorktreeId, leadWorktreeId }) => {
    const host = hosts.find((one) => one.environmentId === environmentId)
    const live = host?.worktrees.some(
      (one) =>
        one.worktreeId === remoteWorktreeId && one.agents.some((row) => !row.restoredUnconfirmed)
    )
    return host && live ? [{ dispatchId, host: host.host, leadWorktreeId }] : []
  })
}
