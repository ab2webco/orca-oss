import type Database from '../sqlite/sync-database'
import { detectAgentStatusFromTitle } from '../../shared/agent-title-status'
import type { RemoteMemberAgent } from '../../shared/orchestrator-game-remote-agent'
import {
  gameAgentStateOf,
  gameReviewOf,
  type GameAgent
} from '../../shared/orchestrator-game-state'
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
  /** The home Run completed the member's task. */
  ticketDone: boolean
  /** Launched by a lead that no longer leads it (ORCA-793). */
  earlierLead: boolean
}

/** What the host's own federationShow reports about the member's terminal. */
export type RemoteGameMemberShow = {
  branch: string
  title: string | null
  liveness: RuntimeTerminalLiveness
  /** The host's hook reading of the agent; absent from an older host (ORCA-837). */
  agent?: RemoteMemberAgent | null
}

type RemoteMemberReads = {
  showOf: (source: RemoteGameMemberSource) => Promise<RemoteGameMemberShow | null>
  reviewOf: (branch: string) => Promise<Parameters<typeof gameReviewOf>[0] | null>
}

const SOURCE_COLUMNS = `f.dispatch_id AS dispatchId, t.task_title AS taskTitle,
              f.environment_name AS hostName, f.environment_id AS environmentId,
              f.remote_terminal_handle AS remoteTerminalHandle,
              f.remote_worktree_id AS remoteWorktreeId, w.stage AS stage,
              COALESCE(d.last_activity_at, d.last_heartbeat_at) AS lastActivityAt,
              d.status NOT IN ('pending', 'dispatched') AS finished,
              COALESCE(t.status, '') = 'completed' AS ticketDone`

const SOURCE_JOINS = `FROM federated_dispatches f
         JOIN dispatch_contexts d ON d.id = f.dispatch_id
         JOIN runs r ON r.id = d.run_id
         LEFT JOIN tasks t ON t.id = d.task_id
         LEFT JOIN worker_dispatches w ON w.dispatch_id = f.dispatch_id`

// Why: a released member's host resources are gone, so it leaves the fleet.
const NOT_RELEASED = `COALESCE(w.stage, '') <> 'released'`

const CURRENT_ERA = `(d.status IN ('pending', 'dispatched')
            OR (COALESCE(w.state, '') NOT IN ('stopped', 'abandoned')
              AND d.completed_at >= r.updated_at))`

// Why a cap: each earlier-lead row costs one federationShow per state read.
const EARLIER_LEAD_LIMIT = 20

type SourceRow = Omit<RemoteGameMemberSource, 'finished' | 'ticketDone' | 'earlierLead'> & {
  finished: number
  ticketDone: number
}

const sourceOf = (row: SourceRow, earlierLead: boolean): RemoteGameMemberSource => ({
  ...row,
  finished: row.finished === 1,
  ticketDone: row.ticketDone === 1,
  earlierLead
})

const sqliteOf = (db: OrchestrationDb): Database.Database =>
  (db as unknown as { db: Database.Database }).db

/**
 * Live remote members of a Run, plus those that finished since the current lead claimed it (the
 * same era cut the inbox uses), so a fresh lead does not inherit yesterday's finished hosts.
 */
export function listRemoteGameMemberSources(
  db: OrchestrationDb,
  runId: string
): RemoteGameMemberSource[] {
  const rows = sqliteOf(db)
    .prepare(
      `SELECT ${SOURCE_COLUMNS}
         ${SOURCE_JOINS}
        WHERE d.run_id = ? AND ${NOT_RELEASED} AND ${CURRENT_ERA}
        ORDER BY d.created_at, d.rowid`
    )
    .all(runId) as SourceRow[]
  return rows.map((row) => sourceOf(row, false))
}

/**
 * Unreleased remote members no live lead shows: those of a Run whose lead is gone, and the current
 * Run's from before this lead claimed it. Another live lead's members stay its own.
 */
export function listEarlierLeadRemoteMemberSources(
  db: OrchestrationDb,
  runId: string,
  leadIsLive: (coordinatorHandle: string) => boolean
): RemoteGameMemberSource[] {
  const rows = sqliteOf(db)
    .prepare(
      `SELECT ${SOURCE_COLUMNS}, d.run_id AS runId, r.coordinator_handle AS coordinatorHandle
         ${SOURCE_JOINS}
        WHERE ${NOT_RELEASED}
          AND COALESCE(w.state, '') NOT IN ('stopped', 'abandoned')
          AND NOT (d.run_id = ? AND ${CURRENT_ERA})
        ORDER BY d.created_at DESC, d.rowid DESC`
    )
    .all(runId) as (SourceRow & {
    runId: string
    coordinatorHandle: string | null
  })[]
  return rows
    .filter(
      (row) =>
        row.runId === runId || row.coordinatorHandle === null || !leadIsLive(row.coordinatorHandle)
    )
    .slice(0, EARLIER_LEAD_LIMIT)
    .toReversed()
    .map(({ runId: _runId, coordinatorHandle: _handle, ...row }) => sourceOf(row, true))
}

const TITLE_STATES = {
  working: 'working',
  permission: 'waiting',
  idle: 'idle'
} as const

/** Fleet rows for remote members; a host that does not answer still lists its member, state unknown. */
export async function remoteGameMembersOf(
  sources: readonly RemoteGameMemberSource[],
  reads: RemoteMemberReads
): Promise<GameAgent[]> {
  const members = await Promise.all(
    sources.map(async (source): Promise<GameAgent | null> => {
      const show = await reads.showOf(source).catch(() => null)
      // Why: an earlier lead's member is only worth listing while its terminal still runs.
      if (source.earlierLead && (show === null || show.liveness === 'gone')) {
        return null
      }
      const titleState = show?.title ? detectAgentStatusFromTitle(show.title) : null
      const stateKnown = show !== null && show.liveness !== 'gone'
      const hosted = show?.branch ? await reads.reviewOf(show.branch).catch(() => null) : null
      const review = hosted ? gameReviewOf(hosted) : null
      // Why: the hooks see a member keep working after its dispatch settles (ORCA-837).
      const agent = stateKnown ? (show?.agent ?? null) : null
      const state: GameAgent['state'] = agent
        ? gameAgentStateOf(agent.state)
        : source.finished
          ? 'done'
          : titleState
            ? TITLE_STATES[titleState]
            : 'idle'
      const lastActivityAt = latestActivityOf(source.lastActivityAt, agent?.updatedAt)
      return {
        paneKey: `remote:${source.dispatchId}`,
        displayName: source.taskTitle ?? source.dispatchId,
        agentType: agent?.agentType ?? null,
        state,
        toolName: null,
        isLeader: false,
        isMember: true,
        remote: {
          host: source.hostName,
          stateKnown,
          ...(source.earlierLead ? { earlierLead: true as const } : {}),
          ...(source.ticketDone ? { ticketDone: true as const } : {})
        },
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
        ...(agent?.limit ? { limit: agent.limit } : {}),
        ...(lastActivityAt ? { lastActivityAt } : {})
      }
    })
  )
  return members.filter((member): member is GameAgent => member !== null)
}

function latestActivityOf(dispatchAt: string | null, hookAt: number | undefined): string | null {
  const hook = hookAt ? new Date(hookAt).toISOString() : null
  if (!dispatchAt || !hook) {
    return dispatchAt ?? hook
  }
  return Date.parse(hook) > Date.parse(dispatchAt) ? hook : dispatchAt
}
