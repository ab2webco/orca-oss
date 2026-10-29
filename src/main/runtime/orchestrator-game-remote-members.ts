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
  createdAt: string
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
  /** Null when the host answers without the member's terminal; rejects when it does not answer. */
  showOf: (source: RemoteGameMemberSource) => Promise<RemoteGameMemberShow | null>
  reviewOf: (branch: string) => Promise<Parameters<typeof gameReviewOf>[0] | null>
}

const SOURCE_COLUMNS = `f.dispatch_id AS dispatchId, t.task_title AS taskTitle,
              f.environment_name AS hostName, f.environment_id AS environmentId,
              f.remote_terminal_handle AS remoteTerminalHandle,
              f.remote_worktree_id AS remoteWorktreeId, w.stage AS stage,
              COALESCE(d.last_activity_at, d.last_heartbeat_at) AS lastActivityAt,
              d.created_at AS createdAt,
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

/** The panes that place a Run's lead; `coordinator*` are null once a newer Run took the pane. */
export type EarlierLeadRunPanes = {
  coordinatorHandle: string | null
  coordinatorPaneKey: string | null
  /** The lead pane that created the member's task, which outlives the Run's binding. */
  creatorPaneKey: string | null
}

/** A Run's lead as this Orca sees it now; `projectKey` is null when no pane places it. */
export type EarlierLeadRunLead = { live: boolean; projectKey: string | null }

/**
 * Unreleased remote members no live lead shows: those of a Run of this lead's project whose lead
 * is gone, and the current Run's from before this lead claimed it. Another live lead's members,
 * and any other project's, stay out.
 */
export function listEarlierLeadRemoteMemberSources(
  db: OrchestrationDb,
  lead: { runId: string; projectKey: string | null },
  leadOf: (run: EarlierLeadRunPanes) => EarlierLeadRunLead
): RemoteGameMemberSource[] {
  const rows = sqliteOf(db)
    .prepare(
      `SELECT ${SOURCE_COLUMNS}, d.run_id AS runId, r.coordinator_handle AS coordinatorHandle,
              r.coordinator_pane_key AS coordinatorPaneKey, t.created_by_pane_key AS creatorPaneKey
         ${SOURCE_JOINS}
        WHERE ${NOT_RELEASED}
          AND COALESCE(w.state, '') NOT IN ('stopped', 'abandoned')
          AND NOT (d.run_id = ? AND ${CURRENT_ERA})
        ORDER BY d.created_at DESC, d.rowid DESC`
    )
    .all(lead.runId) as (SourceRow & EarlierLeadRunPanes & { runId: string })[]
  return rows
    .filter((row) => {
      if (row.runId === lead.runId) {
        return true
      }
      // Why: a lead acts on the members it lists, so another project's must never look like its own (ORCA-848).
      const other = leadOf(row)
      return lead.projectKey !== null && other.projectKey === lead.projectKey && !other.live
    })
    .slice(0, EARLIER_LEAD_LIMIT)
    .toReversed()
    .map(
      ({
        runId: _runId,
        coordinatorHandle: _handle,
        coordinatorPaneKey: _pane,
        creatorPaneKey: _creator,
        ...row
      }) => sourceOf(row, true)
    )
}

/**
 * Task titles of every Run's remote members still holding their host's resources, for the name
 * pool. Not scoped to a project: the home Run DB does not record one, and a skipped name costs nothing.
 */
export function liveRemoteMemberTitlesOf(db: OrchestrationDb): string[] {
  const rows = sqliteOf(db)
    .prepare(
      `SELECT t.task_title AS taskTitle
         ${SOURCE_JOINS}
        WHERE ${NOT_RELEASED}
          AND COALESCE(w.state, '') NOT IN ('stopped', 'abandoned')
          AND t.task_title IS NOT NULL
        ORDER BY d.created_at, d.rowid`
    )
    .all() as { taskTitle: string }[]
  return rows.map((row) => row.taskTitle)
}

const TITLE_STATES = {
  working: 'working',
  permission: 'waiting',
  idle: 'idle'
} as const

/**
 * One source per host worktree: a later `worker-start --on --worktree` there is the same member, so
 * its newest dispatch speaks for it under the first one's title (ORCA-854).
 */
function oneSourcePerWorktree(
  sources: readonly RemoteGameMemberSource[]
): RemoteGameMemberSource[] {
  const groups = Map.groupBy(sources, (source) =>
    source.remoteWorktreeId
      ? `${source.environmentId}\0${source.remoteWorktreeId}`
      : `dispatch\0${source.dispatchId}`
  )
  return [...groups.values()].map((group) => {
    const [oldest, ...later] = group.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    const newest = later.at(-1) ?? oldest!
    return { ...newest, taskTitle: oldest!.taskTitle ?? newest.taskTitle }
  })
}

/** Fleet rows for remote members; a host that does not answer still lists its member, state unknown. */
export async function remoteGameMembersOf(
  sources: readonly RemoteGameMemberSource[],
  reads: RemoteMemberReads
): Promise<GameAgent[]> {
  const members = await Promise.all(
    oneSourcePerWorktree(sources).map(async (source): Promise<GameAgent | null> => {
      const answer = await reads.showOf(source).then(
        (show) => ({ answered: true, show }),
        () => ({ answered: false, show: null })
      )
      const { show } = answer
      const gone = answer.answered && (show === null || show.liveness === 'gone')
      // Why: an earlier lead's member is only worth listing while its terminal still runs.
      if (source.earlierLead && (show === null || gone)) {
        return null
      }
      const titleState = show?.title ? detectAgentStatusFromTitle(show.title) : null
      const hosted = show?.branch ? await reads.reviewOf(show.branch).catch(() => null) : null
      const review = hosted ? gameReviewOf(hosted) : null
      // Why: the hooks see a member keep working after its dispatch settles (ORCA-837).
      const agent = gone ? null : (show?.agent ?? null)
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
          stateKnown: answer.answered,
          ...(source.earlierLead ? { earlierLead: true as const } : {}),
          ...(source.ticketDone ? { ticketDone: true as const } : {}),
          ...(gone ? { gone: true as const } : {})
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
        // Why a home-side id: the host keeps its account ids; this one only keys the tag and counts.
        ...(agent?.account
          ? {
              account: {
                ...agent.account,
                id: `remote:${source.environmentId}:${agent.account.email}`
              }
            }
          : {}),
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
