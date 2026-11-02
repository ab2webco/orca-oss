import {
  gameHostMachineOf,
  type GameHostReading
} from '../../shared/orchestrator-game-host-capacity'
import { LOCAL_GAME_HOST } from '../../shared/orchestrator-game-host-load'

type Deps = {
  list: () => readonly { id: string; name: string }[]
  readLocal: () => Promise<unknown>
  /** The host's `diagnostics.memory` snapshot; rejects when it does not answer. */
  readRemote: (environmentId: string) => Promise<unknown>
  now?: () => number
}

// Why 15 s: load moves faster than the 30 s band poll, and each read is a `ps` sweep on the host.
const FRESH_MS = 15_000

type Cached = { at: number; reading: GameHostReading; refresh?: Promise<void> }

/** This Orca's and each paired host's machine; a stale reading serves while it rereads. */
export class GameHostCapacityReader {
  private readonly cache = new Map<string, Cached>()

  constructor(private readonly deps: Deps) {}

  /** Null while no environment is saved, so a lone Orca shows no hosts. */
  async read(): Promise<{ host: string; reading: GameHostReading }[] | null> {
    const environments = this.deps.list()
    const keys = new Set([LOCAL_GAME_HOST, ...environments.map((one) => one.id)])
    for (const key of this.cache.keys()) {
      if (!keys.has(key) || environments.length === 0) {
        this.cache.delete(key)
      }
    }
    if (environments.length === 0) {
      return null
    }
    const remoteOf = (id: string) => async () =>
      ((await this.deps.readRemote(id)) as { host?: unknown } | null)?.host
    return await Promise.all(
      [
        { key: LOCAL_GAME_HOST, host: LOCAL_GAME_HOST, read: this.deps.readLocal },
        ...environments.map(({ id, name }) => ({ key: id, host: name, read: remoteOf(id) }))
      ].map(async ({ key, host, read }) => ({ host, reading: await this.readingOf(key, read) }))
    )
  }

  private async readingOf(key: string, read: () => Promise<unknown>): Promise<GameHostReading> {
    const cached = this.cache.get(key)
    if (cached && this.now() - cached.at < FRESH_MS) {
      return cached.reading
    }
    if (cached) {
      cached.refresh ??= this.reread(key, read)
      return cached.reading
    }
    await this.reread(key, read)
    return this.cache.get(key)!.reading
  }

  private async reread(key: string, read: () => Promise<unknown>): Promise<void> {
    const machine = await read().then(gameHostMachineOf, () => null)
    const reading: GameHostReading = machine ? { kind: 'ok', machine } : { kind: 'unreachable' }
    this.cache.set(key, { at: this.now(), reading })
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
