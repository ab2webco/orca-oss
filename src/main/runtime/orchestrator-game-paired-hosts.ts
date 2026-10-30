import {
  gameHostCapsOf,
  gameLeadCapOverHostsOf,
  pairedGameHostOf,
  type GameHostCap,
  type PairedGameHostReading
} from '../../shared/orchestrator-game-host-load'
import { resolveOrchestratorGameLead } from '../../shared/orchestrator-game-config'
import { gameLeadSourceOf } from '../../shared/orchestrator-game-lead-source'
import type { GameHostProfile, OrchestratorGameLead } from '../../shared/orchestrator-game-lead'

export type PairedGameHostEntry = { name: string; id: string; reading: PairedGameHostReading }

type Deps = {
  /** The saved environments this Orca can place members on. */
  list: () => readonly { id: string; name: string }[]
  /** The host's `status.get` result; rejects when it does not answer. */
  statusOf: (environmentId: string) => Promise<unknown>
  now?: () => number
}

// Why: a host's memory and cores do not change between band polls, and every state read would dial each host.
const FRESH_MS = 30_000

type Cached = { at: number; reading: PairedGameHostReading; refresh?: Promise<void> }

/** Each paired host's published member cap; a stale reading is served while it refreshes. */
export class GamePairedHostReader {
  private readonly cache = new Map<string, Cached>()

  constructor(private readonly deps: Deps) {}

  async read(): Promise<PairedGameHostEntry[]> {
    const environments = this.deps.list()
    const ids = new Set(environments.map((one) => one.id))
    for (const id of this.cache.keys()) {
      if (!ids.has(id)) {
        this.cache.delete(id)
      }
    }
    return await Promise.all(
      environments.map(async ({ id, name }) => ({ name, id, reading: await this.readingOf(id) }))
    )
  }

  private async readingOf(id: string): Promise<PairedGameHostReading> {
    const now = (this.deps.now ?? Date.now)()
    const cached = this.cache.get(id)
    if (cached && now - cached.at < FRESH_MS) {
      return cached.reading
    }
    if (cached) {
      cached.refresh ??= this.reread(id)
      return cached.reading
    }
    await this.reread(id)
    return this.cache.get(id)!.reading
  }

  private async reread(id: string): Promise<void> {
    const reading = await this.deps.statusOf(id).then(
      (status): PairedGameHostReading => {
        const host = pairedGameHostOf((status as { gameHost?: unknown } | null)?.gameHost)
        return host ? { kind: 'host', host } : { kind: 'older' }
      },
      (): PairedGameHostReading => ({ kind: 'unreachable' })
    )
    this.cache.set(id, { at: (this.deps.now ?? Date.now)(), reading })
  }
}

/**
 * The lead, its cap summed over this Orca and each paired host under the project's cap, with each
 * host's own cap; with no paired host, the lead as its layers resolve.
 */
export async function gameLeadOverPairedHostsOf(
  layers: Parameters<typeof resolveOrchestratorGameLead>[0],
  input: { host?: GameHostProfile; readPairedHosts?: () => Promise<PairedGameHostEntry[]> }
): Promise<{ lead: OrchestratorGameLead; hosts?: GameHostCap[] }> {
  const local = input.host ?? null
  const lead = resolveOrchestratorGameLead(layers, local)
  const paired = input.readPairedHosts ? await input.readPairedHosts().catch(() => null) : null
  // Why only with a paired host: alone, a project's cap stays the one this machine runs.
  if (!paired?.length) {
    return { lead }
  }
  const hosts = gameHostCapsOf(local, paired)
  const ceiling = gameLeadSourceOf(layers, 'cap') === 'default' ? null : lead.cap
  return { lead: { ...lead, cap: gameLeadCapOverHostsOf(hosts, ceiling) }, hosts }
}
