import type Database from '../../sqlite/sync-database'
import { WORKTREE_ID_SEPARATOR } from '../../../shared/worktree/id'

/** A worktree or folder workspace by its exact id, or every worktree of a repo. */
export type RemovedWorkspace = { worktreeId: string } | { repoId: string }

export const WORKSPACE_REMOVED_FAILURE = 'workspace_removed'

/**
 * This machine's live workers in a removed workspace. A paired host's member is never one: its home
 * releases it through the host (ORCA-1478). A member this machine hosts for another home has no
 * worker row here, only an attachment, so it is never listed either.
 */
export function liveLocalWorkersIn(db: Database.Database, removal: RemovedWorkspace): string[] {
  const prefix = 'repoId' in removal ? `${removal.repoId}${WORKTREE_ID_SEPARATOR}` : null
  const rows = db
    .prepare(
      `SELECT w.dispatch_id FROM worker_dispatches w
        WHERE ${prefix === null ? 'w.worktree_id = ?' : 'substr(w.worktree_id, 1, length(?)) = ?'}
          AND w.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
          AND NOT EXISTS (SELECT 1 FROM federated_dispatches f WHERE f.dispatch_id = w.dispatch_id)
        ORDER BY w.rowid`
    )
    .all(...(prefix === null ? [(removal as { worktreeId: string }).worktreeId] : [prefix, prefix]))
  return (rows as { dispatch_id: string }[]).map((row) => row.dispatch_id)
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
