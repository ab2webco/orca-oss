import type Database from '../sqlite/sync-database'
import type { OrchestrationDb } from './orchestration/db'

/** An open member this Orca placed on a paired host, whatever Run's lead placed it (ORCA-1284). */
export type FederatedGameMember = {
  dispatchId: string
  host: string
  leadWorktreeId: string | null
}

// Why here and not the host: a host keeps only an attachment, which its worktree.ps never marks dispatched.
export function listOpenFederatedGameMembers(db: OrchestrationDb): FederatedGameMember[] {
  const sqlite = (db as unknown as { db: Database.Database }).db
  return sqlite
    .prepare(
      `SELECT f.dispatch_id AS dispatchId, f.environment_name AS host,
              CASE WHEN json_valid(w.start_options)
                THEN json_extract(w.start_options, '$.leadWorktreeId') END AS leadWorktreeId
         FROM federated_dispatches f
         JOIN dispatch_contexts d ON d.id = f.dispatch_id
         LEFT JOIN worker_dispatches w ON w.dispatch_id = f.dispatch_id
        WHERE d.status IN ('pending', 'dispatched')
          AND COALESCE(w.stage, '') <> 'released'
          AND COALESCE(w.state, '') NOT IN ('stopped', 'abandoned', 'failed')
        ORDER BY d.created_at, d.rowid`
    )
    .all() as FederatedGameMember[]
}
