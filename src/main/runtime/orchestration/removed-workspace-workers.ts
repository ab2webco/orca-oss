import type Database from '../../sqlite/sync-database'
import { WORKTREE_ID_SEPARATOR } from '../../../shared/worktree/id'
import {
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { parseWorkerTerminalHostScope } from './worker-terminal-process-liveness'

/**
 * A worktree or folder workspace by its exact id, or every worktree of a repo. With `hostId`, only
 * that host's copy of a repo another host also has (ORCA-1491).
 */
export type RemovedWorkspace = { worktreeId: string } | { repoId: string; hostId?: ExecutionHostId }

const LIVE_WORKER_STATES = `('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')`

// Why the terminal resource: a worktree id names no host, so two hosts' copies of a repo share it;
// the worker's own terminal connection is the one record of where it ran.
const HOST_SCOPE_OF_WORKER = `(SELECT r.host_scope FROM worker_terminal_resources r
    WHERE r.owner_dispatch_id = w.dispatch_id OR r.origin_dispatch_id = w.dispatch_id
    ORDER BY r.owner_dispatch_id = w.dispatch_id DESC LIMIT 1)`

/** The execution host a worker's terminal ran on; null when it recorded none. */
export function executionHostOfWorkerScope(hostScope: string | null): ExecutionHostId | null {
  const scope = parseWorkerTerminalHostScope(hostScope)
  if (!scope) {
    return null
  }
  return scope.kind === 'ssh' ? toSshExecutionHostId(scope.targetId) : LOCAL_EXECUTION_HOST_ID
}

const hostOfRemoval = (removal: RemovedWorkspace): ExecutionHostId | null =>
  'repoId' in removal ? (removal.hostId ?? null) : null

export const WORKSPACE_REMOVED_FAILURE = 'workspace_removed'

/**
 * This machine's live workers in a removed workspace. A paired host's member is never one: its home
 * releases it through the host (ORCA-1478). A member this machine hosts for another home has no
 * worker row here, only an attachment, so it is never listed either.
 */
export function liveLocalWorkersIn(db: Database.Database, removal: RemovedWorkspace): string[] {
  const hostId = hostOfRemoval(removal)
  return workersIn(db, removal, true)
    .filter((row) => hostId === null || executionHostOfWorkerScope(row.host_scope) === hostId)
    .map((row) => row.dispatch_id)
}

/**
 * The worktrees of a repo this machine's workers ran in on the removed host only, so a drop there
 * can go while the other host's drop at the same worktree id stays (ORCA-1491).
 */
export function worktreesOnlyOnRemovedHost(
  db: Database.Database,
  removal: RemovedWorkspace
): Set<string> {
  const hostId = hostOfRemoval(removal)
  const onHost = new Set<string>()
  const elsewhere = new Set<string>()
  for (const row of workersIn(db, removal, false)) {
    const host = executionHostOfWorkerScope(row.host_scope)
    if (host === null || !row.worktree_id) {
      continue
    }
    const seen = host === hostId ? onHost : elsewhere
    seen.add(row.worktree_id)
  }
  return new Set([...onHost].filter((id) => !elsewhere.has(id)))
}

function workersIn(
  db: Database.Database,
  removal: RemovedWorkspace,
  liveOnly: boolean
): { dispatch_id: string; worktree_id: string | null; host_scope: string | null }[] {
  const prefix = 'repoId' in removal ? `${removal.repoId}${WORKTREE_ID_SEPARATOR}` : null
  return db
    .prepare(
      `SELECT w.dispatch_id, w.worktree_id, ${HOST_SCOPE_OF_WORKER} AS host_scope
         FROM worker_dispatches w
        WHERE ${prefix === null ? 'w.worktree_id = ?' : 'substr(w.worktree_id, 1, length(?)) = ?'}
          ${liveOnly ? `AND w.state IN ${LIVE_WORKER_STATES}` : ''}
          AND NOT EXISTS (SELECT 1 FROM federated_dispatches f WHERE f.dispatch_id = w.dispatch_id)
        ORDER BY w.rowid`
    )
    .all(
      ...(prefix === null ? [(removal as { worktreeId: string }).worktreeId] : [prefix, prefix])
    ) as { dispatch_id: string; worktree_id: string | null; host_scope: string | null }[]
}

/**
 * Stops one worker whose workspace is gone. Its Task is blocked, as a stop blocks it, when this was
 * its latest dispatch: nothing can carry it on in a workspace that no longer exists.
 */
export function settleRemovedWorkspaceWorker(db: Database.Database, dispatchId: string): void {
  db.prepare(
    `UPDATE worker_dispatches
        SET state = 'stopped', stage = 'workspace_removed', last_error = NULL,
            updated_at = datetime('now')
      WHERE dispatch_id = ?
        AND state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')`
  ).run(dispatchId)
  db.prepare(
    `UPDATE dispatch_contexts
        SET status = 'failed', completed_at = COALESCE(completed_at, datetime('now')),
            last_failure = ?,
            capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
      WHERE id = ? AND status IN ('pending', 'dispatched')`
  ).run(WORKSPACE_REMOVED_FAILURE, dispatchId)
  db.prepare(
    `UPDATE tasks SET status = 'blocked'
      WHERE status = 'dispatched'
        AND id = (SELECT task_id FROM dispatch_contexts WHERE id = ?)
        AND ? = (SELECT d.id FROM dispatch_contexts d
                  WHERE d.task_id = tasks.id ORDER BY d.rowid DESC LIMIT 1)`
  ).run(dispatchId, dispatchId)
}

export type MemberDispatchState = {
  live: boolean
  pairedHost: boolean
  /** The execution host its terminal ran on here; null when it recorded none. */
  hostId: ExecutionHostId | null
}

/** Whether a saved member's dispatch still runs, and where; null if unknown here. */
export function memberDispatchState(
  db: Database.Database,
  dispatchId: string
): MemberDispatchState | null {
  const row = db
    .prepare(
      `SELECT w.state IN ${LIVE_WORKER_STATES} AS live,
              EXISTS (SELECT 1 FROM federated_dispatches f WHERE f.dispatch_id = w.dispatch_id)
                AS paired_host,
              ${HOST_SCOPE_OF_WORKER} AS host_scope
         FROM worker_dispatches w WHERE w.dispatch_id = ?`
    )
    .get(dispatchId) as { live: number; paired_host: number; host_scope: string | null } | undefined
  return row
    ? {
        live: row.live === 1,
        pairedHost: row.paired_host === 1,
        hostId: executionHostOfWorkerScope(row.host_scope)
      }
    : null
}
