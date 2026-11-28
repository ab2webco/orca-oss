import type { OrchestrationDb } from './orchestration/db'
import { sqliteOf } from './orchestrator-game-remote-members'

/** A host worktree a home dispatch placed; `releasedAt` (ms, whole seconds) once it was released. */
export type RemoteMemberWorktree = {
  dispatchId: string
  environmentId: string
  worktreeId: string
  releasedAt: number | null
}

// Why a margin (ORCA-1497): the release is stamped by sqlite's clock, the read by Date.now(), and on
// Windows sqlite's trails by up to a timer tick, so a release just after a read can land a second early.
const RELEASE_CLOCK_MARGIN_MS = 1_000

/** The first whole second whose releases a host read started at `readAt` (ms) may still list. */
export const releaseCutoffSecondOf = (readAt: number): number =>
  Math.floor((readAt - RELEASE_CLOCK_MARGIN_MS) / 1000)

/**
 * Host worktrees these dispatches placed, and those of any member released since `releasedSince`
 * (ms), which a host read from before its release still lists (ORCA-1377).
 */
export function remoteMemberWorktreesOf(
  db: OrchestrationDb,
  dispatchIds: readonly string[],
  releasedSince: number
): RemoteMemberWorktree[] {
  return sqliteOf(db)
    .prepare(
      `SELECT f.dispatch_id AS dispatchId, f.environment_id AS environmentId,
              f.remote_worktree_id AS worktreeId,
              CASE WHEN w.stage = 'released'
                THEN CAST(strftime('%s', w.updated_at) AS INTEGER) * 1000 END AS releasedAt
         FROM federated_dispatches f
         LEFT JOIN worker_dispatches w ON w.dispatch_id = f.dispatch_id
        WHERE f.remote_worktree_id IS NOT NULL
          AND (f.dispatch_id IN (SELECT value FROM json_each(?))
            OR (w.stage = 'released' AND CAST(strftime('%s', w.updated_at) AS INTEGER) >= ?))`
    )
    .all(
      JSON.stringify(dispatchIds),
      releaseCutoffSecondOf(releasedSince)
    ) as RemoteMemberWorktree[]
}
