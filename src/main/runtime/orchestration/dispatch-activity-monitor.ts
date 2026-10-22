import type { RuntimeTerminalAgentStatusState } from '../../../shared/runtime-types'
import type { OrchestrationDb } from './db'

/** What the host already knows about a worker terminal, read without asking the agent. */
export type DispatchActivityObservation = {
  /** The freshest agent hook state for the terminal, if its agent reports hooks. */
  hook: { status: NonNullable<RuntimeTerminalAgentStatusState>; updatedAt: number } | null
  /** Null until the PTY prints in this app session. */
  lastOutputAt: number | null
}

export type DispatchActivityProbe = (assigneeHandle: string) => DispatchActivityObservation

// Why: a working hook means a turn is in progress; an idle one dates the turn's end, and TUI repaints after it are not progress.
function activityAt(observation: DispatchActivityObservation, now: number): number | null {
  if (observation.hook) {
    return observation.hook.status === 'working' ? now : observation.hook.updatedAt
  }
  return observation.lastOutputAt
}

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
    private readonly probe: DispatchActivityProbe
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
      if (db.listActivityWatchedDispatches().length === 0) {
        return false
      }
      recordDispatchActivities(db, this.probe)
    } catch (error) {
      console.warn('[orchestration] dispatch activity scan failed', { error })
    }
    return true
  }
}
