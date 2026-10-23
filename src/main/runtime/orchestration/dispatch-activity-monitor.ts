import type { OrchestrationDb } from './db'
import {
  activityAt,
  type DispatchActivityObservation,
  type DispatchActivityProbe
} from './dispatch-activity-observation'
import type { DispatchDeadlineNotifier } from './dispatch-deadline-monitor'
import { reattachSilentFailures, SILENT_FAILURE_WATCH_MS } from './dispatch-silence-reattach'

export type { DispatchActivityObservation, DispatchActivityProbe }

/** Records each dispatched worker's latest host-observed activity (ORCA-746); no observation leaves it unknown. */
export function recordDispatchActivities(
  db: OrchestrationDb,
  probe: DispatchActivityProbe,
  now: Date = new Date()
): void {
  for (const dispatch of db.listActivityWatchedDispatches()) {
    const at = activityAt(probe(dispatch.assignee_handle), now.getTime())
    if (at !== null) {
      db.recordDispatchActivity(dispatch.id, new Date(at).toISOString())
    }
  }
}

// Why: staleness is judged in minutes, so 30 s bounds the lag without a hot loop.
export const DISPATCH_ACTIVITY_SCAN_INTERVAL_MS = 30_000

/** Keeps `last_activity_at` current while any dispatch is live; idempotent, so every arming point may call it. */
export class DispatchActivityMonitor {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly db: () => OrchestrationDb,
    private readonly probe: DispatchActivityProbe,
    private readonly notifier: DispatchDeadlineNotifier
  ) {}

  ensure(): void {
    if (this.timer) {
      return
    }
    if (!this.scan()) {
      return
    }
    const timer = setInterval(() => {
      if (!this.scan()) {
        this.stop()
      }
    }, DISPATCH_ACTIVITY_SCAN_INTERVAL_MS)
    timer.unref?.()
    this.timer = timer
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** False once nothing is left to watch. */
  private scan(): boolean {
    try {
      const db = this.db()
      const now = new Date()
      // Why (ORCA-658): a dispatch the deadline just failed may still be working, so it is watched too.
      const since = new Date(now.getTime() - SILENT_FAILURE_WATCH_MS).toISOString()
      if (
        db.listActivityWatchedDispatches().length === 0 &&
        db.listWatchedSilenceFailures(since).length === 0
      ) {
        return false
      }
      recordDispatchActivities(db, this.probe, now)
      reattachSilentFailures(db, this.probe, this.notifier, now)
    } catch (error) {
      console.warn('[orchestration] dispatch activity scan failed', { error })
    }
    return true
  }
}
