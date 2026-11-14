/** A paired host the game skipped: it did not answer within the deadline, now or a moment ago. */
export class GameHostUnansweredError extends Error {
  constructor(readonly environmentId: string) {
    super(`Paired host ${environmentId} did not answer.`)
    this.name = 'GameHostUnansweredError'
  }
}

const isTimeout = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 'runtime_timeout' ||
  (error instanceof Error && /timed out/i.test(error.message))

/**
 * Bounds the game's reads of a paired host by wall time, queue wait included, and skips a host
 * that did not answer for a while. Why: a call's own timeout starts only once the host's call
 * queue runs it, so one silent host held every lead state read past the panel's deadline (ORCA-1199).
 */
export class GameHostAnswerGate {
  private readonly downUntil = new Map<string, number>()

  constructor(private readonly options: { downForMs: number; now?: () => number }) {}

  async call<T>(environmentId: string, read: () => Promise<T>, deadlineMs: number): Promise<T> {
    const until = this.downUntil.get(environmentId)
    if (until !== undefined) {
      if (this.now() < until) {
        throw new GameHostUnansweredError(environmentId)
      }
      this.downUntil.delete(environmentId)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GameHostUnansweredError(environmentId)), deadlineMs)
    })
    try {
      return await Promise.race([read(), deadline])
    } catch (error) {
      if (error instanceof GameHostUnansweredError || isTimeout(error)) {
        this.downUntil.set(environmentId, this.now() + this.options.downForMs)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
