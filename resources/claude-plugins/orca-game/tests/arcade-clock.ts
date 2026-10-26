import type { ArcadeClock } from '../hooks/arcade-loop'

// A clock the test advances by hand: every timer fires on its own period, in time order.
export const fakeClock = () => {
  let now = 0
  const timers = new Set<{ ms: number; next: number; fn: () => void }>()
  const clock: ArcadeClock = {
    now: async () => now,
    every: (ms, fn) => {
      const timer = { ms, next: now + ms, fn }
      timers.add(timer)
      return { cancel: () => void timers.delete(timer) }
    }
  }
  const advance = async (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].sort((a, b) => a.next - b.next)[0]
      if (due === undefined || due.next > end) {
        break
      }
      now = due.next
      due.next += due.ms
      due.fn()
      // Why several turns: a tick awaits the pane's focus and the clock before it draws.
      for (let turn = 0; turn < 10; turn += 1) {
        await Promise.resolve()
      }
    }
    now = end
  }
  return { clock, advance, timers }
}
