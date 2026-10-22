import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './db'
import {
  DISPATCH_ACTIVITY_SCAN_INTERVAL_MS,
  DispatchActivityMonitor,
  recordDispatchActivities,
  type DispatchActivityObservation
} from './dispatch-activity-monitor'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const minutesAgo = (minutes: number): number => NOW - minutes * 60_000
const iso = (ms: number): string => new Date(ms).toISOString()

describe('recordDispatchActivities (ORCA-746)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function dispatchFor(handle: string): string {
    db ??= new OrchestrationDb(':memory:')
    const task = db.createTask({ spec: `work for ${handle}` })
    return db.createDispatchContext(task.id, handle).id
  }

  function activityOf(dispatchId: string): string | null {
    return db?.getDispatchContextById(dispatchId)?.last_activity_at ?? null
  }

  function run(observations: Record<string, DispatchActivityObservation>): void {
    recordDispatchActivities(
      db as OrchestrationDb,
      (handle) => observations[handle] ?? { hook: null, lastOutputAt: null },
      new Date(NOW)
    )
  }

  it('counts a fresh working hook as activity now, even when the terminal printed nothing', () => {
    const working = dispatchFor('term_working')

    run({
      term_working: { hook: { status: 'working', updatedAt: minutesAgo(9) }, lastOutputAt: null }
    })

    expect(activityOf(working)).toBe(iso(NOW))
  })

  it("takes an idle agent's activity from its hook, not from later terminal repaints", () => {
    const idle = dispatchFor('term_idle')

    run({
      term_idle: {
        hook: { status: 'idle', updatedAt: minutesAgo(20) },
        lastOutputAt: minutesAgo(1)
      }
    })

    expect(activityOf(idle)).toBe(iso(minutesAgo(20)))
  })

  it('falls back to terminal output when the agent reports no hooks, and leaves unknown as null', () => {
    const noHooks = dispatchFor('term_nohooks')
    const unknown = dispatchFor('term_unknown')

    run({ term_nohooks: { hook: null, lastOutputAt: minutesAgo(3) } })

    expect(activityOf(noHooks)).toBe(iso(minutesAgo(3)))
    expect(activityOf(unknown)).toBeNull()
  })

  it('watches on a timer only while a dispatch is live, and a second ensure starts no second timer', () => {
    vi.useFakeTimers({ now: NOW })
    try {
      const live = dispatchFor('term_live')
      const probe = vi.fn((): DispatchActivityObservation => ({ hook: null, lastOutputAt: null }))
      const monitor = new DispatchActivityMonitor(() => db as OrchestrationDb, probe)

      monitor.ensure()
      monitor.ensure()
      expect(probe).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(DISPATCH_ACTIVITY_SCAN_INTERVAL_MS)
      expect(probe).toHaveBeenCalledTimes(2)

      db?.completeDispatch(live)
      vi.advanceTimersByTime(DISPATCH_ACTIVITY_SCAN_INTERVAL_MS * 3)
      expect(probe).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never moves activity backwards and never touches a finished dispatch', () => {
    const live = dispatchFor('term_live')
    const done = dispatchFor('term_done')
    run({
      term_live: { hook: null, lastOutputAt: minutesAgo(2) },
      term_done: { hook: null, lastOutputAt: minutesAgo(2) }
    })
    db?.completeDispatch(done)

    run({
      term_live: { hook: null, lastOutputAt: minutesAgo(30) },
      term_done: { hook: { status: 'working', updatedAt: minutesAgo(1) }, lastOutputAt: null }
    })

    expect(activityOf(live)).toBe(iso(minutesAgo(2)))
    expect(activityOf(done)).toBe(iso(minutesAgo(2)))
  })
})
