import { gameAgentOf, type GameAgent } from '../../shared/orchestrator-game-state'
import type { RuntimeWorktreePsSummary } from '../../shared/runtime-types'

/** One paired host's `worktree.ps` worktrees. */
export type RemoteHostSessions = {
  environmentId: string
  host: string
  worktrees: readonly RuntimeWorktreePsSummary[]
}

/** Key of a host worktree a lead already lists, as `remoteFoundSessionsOf` matches it. */
export const remoteWorktreeKeyOf = (environmentId: string, worktreeId: string): string =>
  `${environmentId}\0${worktreeId}`

/**
 * Agents of this project on paired hosts that no lead lists: not a host's own lead or its members,
 * not in a worktree a lead already shows, and not a hydrated row (ORCA-943). Found rows hold no slot.
 */
export function remoteFoundSessionsOf(
  hosts: readonly RemoteHostSessions[],
  project: { repoName: string; listed: ReadonlySet<string> }
): GameAgent[] {
  return hosts.flatMap(({ environmentId, host, worktrees }) => {
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
              remote: { host, environmentId, stateKnown: true },
              worktree: {
                id: one.worktreeId,
                branch: one.branch.replace(/^refs\/heads\//, ''),
                displayName: one.displayName
              },
              ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt } : {}),
              stateSince: row.stateStartedAt
            })
          )
      )
  })
}

// Why 30 s: each read is a `worktree.ps` sweep on the host, and the band polls every 30 s.
const FRESH_MS = 30_000

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
        worktrees: await this.worktreesOf(id)
      }))
    )
  }

  private async worktreesOf(environmentId: string): Promise<RuntimeWorktreePsSummary[]> {
    const cached = this.cache.get(environmentId)
    if (cached && this.now() - cached.at < FRESH_MS) {
      return cached.worktrees
    }
    if (cached) {
      cached.refresh ??= this.reread(environmentId)
      return cached.worktrees
    }
    await this.reread(environmentId)
    return this.cache.get(environmentId)?.worktrees ?? []
  }

  private async reread(environmentId: string): Promise<void> {
    const worktrees = await this.deps
      .readPs(environmentId)
      .then((ps) => ps.worktrees ?? [])
      .catch(() => [])
    this.cache.set(environmentId, { at: this.now(), worktrees })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
