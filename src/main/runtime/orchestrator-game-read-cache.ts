const CACHE_MAX_ENTRIES = 64

/** A fixed TTL, or one read at each read so a low GitHub budget can stretch it (ORCA-877). */
export type GameCacheTtl = number | (() => number)

export const gameCacheTtlMs = (ttl: GameCacheTtl): number => (typeof ttl === 'number' ? ttl : ttl())

/** One load per key and TTL, shared by concurrent reads; a failed load answers null until it expires. */
export class GameReadCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T | null> }>()

  constructor(
    private readonly ttlMs: GameCacheTtl,
    private readonly now: () => number = Date.now
  ) {}

  read(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const at = this.now()
    const cached = this.entries.get(key)
    if (cached && at - cached.at < gameCacheTtlMs(this.ttlMs)) {
      return cached.value
    }
    const value = load().catch(() => null)
    this.entries.delete(key)
    this.entries.set(key, { at, value })
    if (this.entries.size > CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) {
        this.entries.delete(oldest)
      }
    }
    return value
  }
}
