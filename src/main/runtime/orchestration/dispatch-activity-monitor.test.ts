import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
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
      const monitor = new DispatchActivityMonitor(() => db as OrchestrationDb, probe, {
        notifyMessageArrived: () => {}
      })

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

  it('keeps watching after the deadline fails its only dispatch, and reattaches it once it works (ORCA-658)', () => {
    const dispatchId = dispatchFor('term_slow')
    const d = db as OrchestrationDb
    const probe = vi.fn(
      (): DispatchActivityObservation => ({ hook: null, lastOutputAt: Date.now() + 5_000 })
    )
    const notified: string[] = []
    const monitor = new DispatchActivityMonitor(() => d, probe, {
      notifyMessageArrived: (handle) => notified.push(handle)
    })
    d.mintDispatchCapability({ dispatchId, paneKey: 'tab_w:pane', processIncarnation: 'inc' })
    d.armDispatchLifecycleDeadline(dispatchId, 0)
    expect(
      d.expireDispatchLifecycleDeadline({
        dispatchId,
        nowIso: new Date(Date.now() + 60_000).toISOString(),
        reason: 'no lifecycle signal',
        subject: 'Dispatch failed: no lifecycle signal'
      }).expired
    ).toBe(true)

    monitor.ensure()
    monitor.stop()

    expect(d.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
    expect(notified).toEqual([`run:${d.getDispatchContextById(dispatchId)?.run_id}`])
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

  it('adds the column to a database an older build stamped v35, keeping its dispatches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-746-v35-'))
    try {
      const path = join(dir, 'orchestration.db')
      const older = new OrchestrationDb(path)
      const task = older.createTask({ spec: 'from an older build' })
      const dispatchId = older.createDispatchContext(task.id, 'term_old').id
      older.close()
      const raw = new Database(path)
      raw.exec('ALTER TABLE dispatch_contexts DROP COLUMN last_activity_at')
      raw.pragma('user_version = 35')
      raw.close()

      db = new OrchestrationDb(path)
      db.recordDispatchActivity(dispatchId, iso(minutesAgo(1)))

      expect(activityOf(dispatchId)).toBe(iso(minutesAgo(1)))
    } finally {
      db?.close()
      db = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
