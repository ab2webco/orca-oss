// Why: will-quit defers app.quit() until teardown settles. Teardown members
// are individually bounded, but a wedged transport (half-open post-sleep
// socket) can leave one unsettled forever and make Force Quit the only way
// out (#9447). Racing a deadline guarantees quit always completes.

// Why: generous enough for daemon checkpoint writes on a slow disk; small
// enough that a wedged teardown never needs Force Quit.
export const WILL_QUIT_TEARDOWN_DEADLINE_MS = 20_000

export type NamedQuitTeardown = {
  name: string
  promise: Promise<unknown>
}

export type QuitTeardownObserver = {
  memberSettled?: (name: string, elapsedMs: number, outcome: 'fulfilled' | 'rejected') => void
  /** Fires once at `pendingReportMs` if any member is still unsettled. */
  stillPending?: (pendingNames: string[], elapsedMs: number) => void
  pendingReportMs?: number
}

export async function settleTeardownWithinDeadline(
  teardowns: readonly NamedQuitTeardown[],
  deadlineMs: number = WILL_QUIT_TEARDOWN_DEADLINE_MS,
  observer: QuitTeardownObserver = {}
): Promise<string[]> {
  const startedAt = performance.now()
  const elapsed = (): number => Math.round(performance.now() - startedAt)
  const pendingNames = new Set(teardowns.map(({ name }) => name))
  const settled = Promise.allSettled(
    teardowns.map(({ name, promise }) =>
      promise.then(
        () => {
          pendingNames.delete(name)
          observer.memberSettled?.(name, elapsed(), 'fulfilled')
        },
        (error: unknown) => {
          pendingNames.delete(name)
          observer.memberSettled?.(name, elapsed(), 'rejected')
          throw error
        }
      )
    )
  ).then(() => 'settled' as const)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), deadlineMs)
    timer.unref?.()
  })
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  if (observer.stillPending && observer.pendingReportMs !== undefined) {
    const report = observer.stillPending
    pendingTimer = setTimeout(() => {
      if (pendingNames.size > 0) {
        report([...pendingNames], elapsed())
      }
    }, observer.pendingReportMs)
    pendingTimer.unref?.()
  }
  const outcome = await Promise.race([settled, deadline])
  clearTimeout(timer)
  clearTimeout(pendingTimer)
  return outcome === 'deadline' ? [...pendingNames] : []
}
