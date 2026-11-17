import type { GameHostLaunches } from '../../shared/orchestrator-game-host-capacity'
import {
  gameHostLaunchOf,
  type GameRepoSummary
} from '../../shared/orchestrator-game-member-repo-scope'

type Deps = {
  list: () => readonly { id: string; name: string }[]
  /** The host's registered repos, as `game.memberRepoScope` reads them; rejects when it does not answer. */
  readRepos: (environmentId: string) => Promise<GameRepoSummary[]>
  /** The lead's repo on this Orca, as `game.memberRepoScope` reads it. */
  readLead: (repoId: string) => Promise<GameRepoSummary | null>
  now?: () => number
}

/** `repos` is null for a host that did not list them. */
export type GameHostRepoRead = {
  lead: GameRepoSummary | null
  hosts: { host: string; repos: GameRepoSummary[] | null }[]
}

// Why a minute: a host's repos change when someone registers one, far slower than its load.
const FRESH_MS = 60_000
const SILENT_FRESH_MS = 15_000

type Cached<T> = { at: number; value: T | null; refresh?: Promise<void> }

/** Each paired host's repos and the lead's own; a stale read serves while it rereads. */
export class GameHostLaunchReader {
  private readonly hosts = new Map<string, Cached<GameRepoSummary[]>>()
  private readonly leads = new Map<string, Cached<GameRepoSummary>>()

  constructor(private readonly deps: Deps) {}

  async read(leadRepoId: string | null): Promise<GameHostRepoRead> {
    const environments = this.deps.list()
    const ids = new Set(environments.map((one) => one.id))
    for (const key of this.hosts.keys()) {
      if (!ids.has(key)) {
        this.hosts.delete(key)
      }
    }
    const [lead, hosts] = await Promise.all([
      leadRepoId === null
        ? null
        : this.cached(this.leads, leadRepoId, () => this.deps.readLead(leadRepoId)),
      Promise.all(
        environments.map(async ({ id, name }) => ({
          host: name,
          repos: await this.cached(this.hosts, id, () => this.deps.readRepos(id))
        }))
      )
    ])
    return { lead, hosts }
  }

  private async cached<T>(
    cache: Map<string, Cached<T>>,
    key: string,
    read: () => Promise<T | null>
  ): Promise<T | null> {
    const entry = cache.get(key)
    const reread = async (): Promise<void> => {
      cache.set(key, { at: this.now(), value: await read().catch(() => null) })
    }
    const fresh = entry?.value === null ? SILENT_FRESH_MS : FRESH_MS
    if (entry && this.now() - entry.at < fresh) {
      return entry.value
    }
    if (entry) {
      entry.refresh ??= reread()
      return entry.value
    }
    await reread()
    return cache.get(key)!.value
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}

/** The same check `game launch --on` runs, per paired host (ORCA-1207). */
export function gameHostLaunchesOf(
  read: GameHostRepoRead,
  memberRepos?: readonly string[]
): GameHostLaunches {
  return new Map(
    read.hosts.map(({ host, repos }) => [
      host,
      repos === null
        ? { kind: 'unanswered' }
        : gameHostLaunchOf({ lead: read.lead, host, repos, memberRepos })
    ])
  )
}
