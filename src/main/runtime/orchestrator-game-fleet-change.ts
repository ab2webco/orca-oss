export type GameFleetWait = { version: number; changed: boolean }

/** Versions the fleet a game band draws, so `orca game watch` wakes on a change instead of a poll. */
export class GameFleetChangeSignal {
  private current = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly waiters = new Set<() => void>()

  constructor(private readonly delayMs = 250) {}

  version(): number {
    return this.current
  }

  /** A burst (launch = worktree + terminal + record) is one version. */
  changed(): void {
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.current += 1
      for (const wake of this.waiters) {
        wake()
      }
    }, this.delayMs)
    this.timer.unref?.()
  }

  // Why `!==` and not `>`: a host restart resets the count, and that caller must refresh too.
  wait(since: number, timeoutMs: number): Promise<GameFleetWait> {
    if (since !== this.current) {
      return Promise.resolve({ version: this.current, changed: true })
    }
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timeout)
        this.waiters.delete(done)
        resolve({ version: this.current, changed: this.current !== since })
      }
      const timeout = setTimeout(done, timeoutMs)
      timeout.unref?.()
      this.waiters.add(done)
    })
  }
}
