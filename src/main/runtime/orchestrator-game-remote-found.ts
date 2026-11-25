import { gameAgentOf, type GameAgent } from '../../shared/orchestrator-game-state'
import type { RuntimeWorktreePsSummary } from '../../shared/runtime-types'
import type { RemoteMemberWorktree } from './orchestrator-game-remote-member-worktrees'

/** One paired host's `worktree.ps` worktrees, as read at `readAt` (ms). */
export type RemoteHostSessions = {
  environmentId: string
  host: string
  worktrees: readonly RuntimeWorktreePsSummary[]
  readAt: number
}

/** Key of a host worktree a lead already lists, as `remoteFoundSessionsOf` matches it. */
export const remoteWorktreeKeyOf = (environmentId: string, worktreeId: string): string =>
  `${environmentId}\0${worktreeId}`

/**
 * Host worktrees no found row may claim (ORCA-1377): those the lead lists, its live remote members'
 * even with no branch (a detached HEAD), and those released since the host read that still shows them.
 */
export function listedRemoteWorktreesOf(
  agents: readonly GameAgent[],
  placed: readonly RemoteMemberWorktree[],
  hosts: readonly RemoteHostSessions[]
): Set<string> {
  const live = new Set(
    agents.flatMap((agent) =>
      agent.paneKey.startsWith('remote:') && agent.remote && !agent.remote.gone
        ? [agent.paneKey.slice('remote:'.length)]
        : []
    )
  )
  const readAt = new Map(hosts.map((one) => [one.environmentId, one.readAt]))
  // Why whole seconds: the home records a release at sqlite's second precision.
  const releasedSinceRead = (one: RemoteMemberWorktree): boolean => {
    const read = readAt.get(one.environmentId)
    return one.releasedAt !== null && read !== undefined && one.releasedAt >= read - (read % 1000)
  }
  return new Set([
    ...agents.flatMap((agent) =>
      agent.remote?.environmentId && agent.worktree
        ? [remoteWorktreeKeyOf(agent.remote.environmentId, agent.worktree.id)]
        : []
    ),
    ...placed
      .filter(
        (one) => (one.releasedAt === null && live.has(one.dispatchId)) || releasedSinceRead(one)
      )
      .map((one) => remoteWorktreeKeyOf(one.environmentId, one.worktreeId))
  ])
}

/**
 * Agents of this project on paired hosts that no lead lists: not a host's own lead or its members,
 * not in a worktree a lead already shows, and not a hydrated row (ORCA-943). Found rows hold no slot.
 */
export function remoteFoundSessionsOf(
  hosts: readonly RemoteHostSessions[],
  project: { repoName: string; listed: ReadonlySet<string> },
  now = Date.now()
): GameAgent[] {
  return hosts.flatMap(({ environmentId, host, worktrees, readAt }) => {
    // Why (ORCA-1395): a host whose reread hangs keeps serving its last read, which proves nothing now.
    const stateKnown = now - readAt <= FOUND_STATE_KNOWN_MS
    const rows = worktrees.flatMap((one) => one.agents)
    const present = new Set(rows.map((row) => row.paneKey))
    const parents = new Set(rows.flatMap((row) => (row.parentPaneKey ? [row.parentPaneKey] : [])))
    return worktrees
      .filter(
        (one) =>
          one.repo === project.repoName &&
          // Why: a host's main checkout is where its own lead runs, never a ticket worktree.
          !one.isMainWorktree &&
          !one.isArchived &&
          !project.listed.has(remoteWorktreeKeyOf(environmentId, one.worktreeId))
      )
      .flatMap((one) =>
        one.agents
          .filter(
            (row) =>
              !row.restoredUnconfirmed &&
              !parents.has(row.paneKey) &&
              (!row.parentPaneKey || !present.has(row.parentPaneKey))
          )
          .map(
            (row): GameAgent => ({
              ...gameAgentOf(row, null),
              paneKey: `remote-found:${environmentId}:${row.paneKey}`,
              displayName: row.displayName ?? row.taskTitle ?? one.displayName,
              isMember: true,
              found: true,
              remote: { host, environmentId, stateKnown },
              worktree: {
                id: one.worktreeId,
                branch: one.branch.replace(/^refs\/heads\//, ''),
                displayName: one.displayName
              },
              ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt } : {}),
              stateSince: row.stateStartedAt,
              hookAt: row.updatedAt
            })
          )
      )
  })
}

// Why 30 s: each read is a `worktree.ps` sweep on the host, and the band polls every 30 s.
const FRESH_MS = 30_000
// Why 3 reads: the reader serves its last read while it rereads, so one a poll old is still current.
const FOUND_STATE_KNOWN_MS = 3 * FRESH_MS

type CachedSessions = { at: number; worktrees: RuntimeWorktreePsSummary[]; refresh?: Promise<void> }

/** Each paired host's worktrees; a stale read serves while it rereads, and a silent host lists none. */
export class RemoteHostSessionsReader {
  private readonly cache = new Map<string, CachedSessions>()

  constructor(
    private readonly deps: {
      list: () => readonly { id: string; name: string }[]
      readPs: (environmentId: string) => Promise<{ worktrees?: RuntimeWorktreePsSummary[] }>
      now?: () => number
    }
  ) {}

  async read(): Promise<RemoteHostSessions[]> {
    const environments = this.deps.list()
    const ids = new Set(environments.map((one) => one.id))
    for (const key of this.cache.keys()) {
      if (!ids.has(key)) {
        this.cache.delete(key)
      }
    }
    return await Promise.all(
      environments.map(async ({ id, name }) => ({
        environmentId: id,
        host: name,
        ...(await this.worktreesOf(id))
      }))
    )
  }

  private async worktreesOf(
    environmentId: string
  ): Promise<{ worktrees: RuntimeWorktreePsSummary[]; readAt: number }> {
    const cached = this.cache.get(environmentId)
    if (cached && this.now() - cached.at < FRESH_MS) {
      return { worktrees: cached.worktrees, readAt: cached.at }
    }
    if (cached) {
      cached.refresh ??= this.reread(environmentId)
      return { worktrees: cached.worktrees, readAt: cached.at }
    }
    await this.reread(environmentId)
    const read = this.cache.get(environmentId)
    return { worktrees: read?.worktrees ?? [], readAt: read?.at ?? this.now() }
  }

  private async reread(environmentId: string): Promise<void> {
    // Why the start: a worktree released while the host answers may still be in what it lists.
    const at = this.now()
    const worktrees = await this.deps
      .readPs(environmentId)
      .then((ps) => ps.worktrees ?? [])
      .catch(() => [])
    this.cache.set(environmentId, { at, worktrees })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
