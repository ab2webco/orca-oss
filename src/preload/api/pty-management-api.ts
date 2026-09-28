// Mirror of daemon's `DaemonSessionInfo` (src/main/daemon/types.ts); not imported — preload can't depend on main-only protocol types.
export type PtyManagementSession = {
  sessionId: string
  state: 'created' | 'spawning' | 'running' | 'exiting' | 'exited'
  shellState: 'pending' | 'ready' | 'timed_out' | 'unsupported'
  isAlive: boolean
  pid: number | null
  cwd: string | null
  cols: number
  rows: number
  createdAt: number
  protocolVersion: number
}

// 'severed': macOS can no longer attribute daemon terminals to Orca, so Accessibility/
// Automation grants silently stop applying until the daemon is restarted (STA-3491).
export type PtyManagementMacTccAttributionHealth = 'intact' | 'severed' | 'unknown'

// Mirror of daemon-init's DaemonStaleBundleNoticeStatus (ORCA-534); not imported for the same
// reason as PtyManagementSession above.
export type PtyManagementStaleBundleNoticeStatus =
  | { stale: false }
  | { stale: true; pid: number; startedAtMs: number | null; dismissed: boolean }

export type PtyManagementApi = {
  // `degraded`: daemon is alive but can't spawn fresh PTYs, so new terminals run locally without daemon persistence.
  listSessions: () => Promise<{ sessions: PtyManagementSession[]; degraded: boolean }>
  killAll: () => Promise<{
    killedCount: number
    remainingCount: number
    killedSessionIds?: string[]
  }>
  killOne: (args: { sessionId: string }) => Promise<{ success: boolean }>
  restart: () => Promise<{ success: boolean }>
  macTccAttribution: () => Promise<{ health: PtyManagementMacTccAttributionHealth }>
  staleBundleNotice: () => Promise<PtyManagementStaleBundleNoticeStatus>
  dismissStaleBundleNotice: (args: {
    pid: number
    startedAtMs: number | null
  }) => Promise<{ success: boolean }>
}
