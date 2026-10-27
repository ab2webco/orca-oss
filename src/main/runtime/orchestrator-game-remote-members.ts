import type Database from '../sqlite/sync-database'
import { detectAgentStatusFromTitle } from '../../shared/agent-title-status'
import { gameReviewOf, type GameAgent } from '../../shared/orchestrator-game-state'
import type { RuntimeTerminalLiveness } from '../../shared/runtime-types'
import type { OrchestrationDb } from './orchestration/db'

/** A member the lead's Run placed on a paired host with `worker-start --on`, as the home database records it. */
export type RemoteGameMemberSource = {
  dispatchId: string
  taskTitle: string | null
  hostName: string
  environmentId: string
  remoteTerminalHandle: string | null
  remoteWorktreeId: string | null
  stage: string | null
  lastActivityAt: string | null
  finished: boolean
}

/** What the host's own federationShow reports about the member's terminal. */
export type RemoteGameMemberShow = {
  branch: string
  title: string | null
  liveness: RuntimeTerminalLiveness
}

type RemoteMemberReads = {
  showOf: (source: RemoteGameMemberSource) => Promise<RemoteGameMemberShow | null>
  reviewOf: (branch: string) => Promise<Parameters<typeof gameReviewOf>[0] | null>
}

/**
 * Live remote members of a Run, plus those that finished since the current lead claimed it (the
 * same era cut the inbox uses), so a fresh lead does not inherit yesterday's finished hosts.
 */
export function listRemoteGameMemberSources(
  db: OrchestrationDb,
  runId: string
): RemoteGameMemberSource[] {
  const sqlite = (db as unknown as { db: Database.Database }).db
  const rows = sqlite
    .prepare(
      `SELECT f.dispatch_id AS dispatchId, t.task_title AS taskTitle,
              f.environment_name AS hostName, f.environment_id AS environmentId,
              f.remote_terminal_handle AS remoteTerminalHandle,
              f.remote_worktree_id AS remoteWorktreeId, w.stage AS stage,
              COALESCE(d.last_activity_at, d.last_heartbeat_at) AS lastActivityAt,
              d.status NOT IN ('pending', 'dispatched') AS finished
         FROM federated_dispatches f
         JOIN dispatch_contexts d ON d.id = f.dispatch_id
         JOIN runs r ON r.id = d.run_id
         LEFT JOIN tasks t ON t.id = d.task_id
         LEFT JOIN worker_dispatches w ON w.dispatch_id = f.dispatch_id
        WHERE d.run_id = ?
          AND (d.status IN ('pending', 'dispatched')
            OR (COALESCE(w.state, '') NOT IN ('stopped', 'abandoned')
              AND d.completed_at >= r.updated_at))
        ORDER BY d.created_at, d.rowid`
    )
    .all(runId) as (Omit<RemoteGameMemberSource, 'finished'> & { finished: number })[]
  return rows.map((row) => ({ ...row, finished: row.finished === 1 }))
}

const TITLE_STATES = { working: 'working', permission: 'waiting', idle: 'idle' } as const

/** Fleet rows for remote members; a host that does not answer still lists its member, state unknown. */
export async function remoteGameMembersOf(
  sources: readonly RemoteGameMemberSource[],
  reads: RemoteMemberReads
): Promise<GameAgent[]> {
  return await Promise.all(
    sources.map(async (source) => {
      const show = await reads.showOf(source).catch(() => null)
      const titleState = show?.title ? detectAgentStatusFromTitle(show.title) : null
      const stateKnown = show !== null && show.liveness !== 'gone'
      const hosted = show?.branch ? await reads.reviewOf(show.branch).catch(() => null) : null
      const review = hosted ? gameReviewOf(hosted) : null
      const state: GameAgent['state'] = source.finished
        ? 'done'
        : titleState
          ? TITLE_STATES[titleState]
          : 'idle'
      return {
        paneKey: `remote:${source.dispatchId}`,
        displayName: source.taskTitle ?? source.dispatchId,
        agentType: null,
        state,
        toolName: null,
        isLeader: false,
        isMember: true,
        remote: { host: source.hostName, stateKnown },
        ...(source.remoteTerminalHandle ? { terminalHandle: source.remoteTerminalHandle } : {}),
        ...(source.remoteWorktreeId && show?.branch
          ? {
              worktree: {
                id: source.remoteWorktreeId,
                branch: show.branch,
                displayName: source.taskTitle ?? show.branch
              }
            }
          : {}),
        ...(review ? { review } : {}),
        ...(source.lastActivityAt ? { lastActivityAt: source.lastActivityAt } : {})
      }
    })
  )
}
