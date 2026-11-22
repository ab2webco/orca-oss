const CACHE_MAX_ENTRIES = 64

/** A fixed TTL, or one read at each read so a low GitHub budget can stretch it (ORCA-877). */
export type GameCacheTtl = number | (() => number)

export const gameCacheTtlMs = (ttl: GameCacheTtl): number => (typeof ttl === 'number' ? ttl : ttl())

/**
 * One load per key and TTL, shared by concurrent reads; a failed load answers null until it expires.
 * `refreshInBackground`: an expired entry answers its last value and reloads once behind it, so a
 * read waits only on a key's first load.
 */
export class GameReadCache<T> {
  private readonly entries = new Map<
    string,
    { at: number; value: Promise<T | null>; settled?: T | null; reloading?: boolean }
  >()

  constructor(
    private readonly ttlMs: GameCacheTtl,
    private readonly now: () => number = Date.now,
    private readonly options: { refreshInBackground?: boolean } = {}
  ) {}

  read(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const at = this.now()
    const cached = this.entries.get(key)
    if (cached && at - cached.at < gameCacheTtlMs(this.ttlMs)) {
      return cached.value
    }
    if (cached && this.options.refreshInBackground) {
      if (!('settled' in cached)) {
        return cached.value
      }
      if (!cached.reloading) {
        cached.reloading = true
        void this.load(key, at, load, true)
      }
      return Promise.resolve(cached.settled ?? null)
    }
    return this.load(key, at, load, false)
  }

  /** Drops `key`, so its next read loads and waits. */
  forget(key: string): void {
    this.entries.delete(key)
  }

  // Why put a background reload only once it lands: the expired entry answers reads until then.
  private load(
    key: string,
    at: number,
    load: () => Promise<T | null>,
    behind: boolean
  ): Promise<T | null> {
    const value = load().catch(() => null)
    const entry: { at: number; value: Promise<T | null>; settled?: T | null } = { at, value }
    void value.then((settled) => {
      entry.settled = settled
      if (behind) {
        this.put(key, entry)
      }
    })
    if (!behind) {
      this.put(key, entry)
    }
    return value
  }

  private put(key: string, entry: { at: number; value: Promise<T | null> }): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) {
        this.entries.delete(oldest)
      }
    }
  }
}
