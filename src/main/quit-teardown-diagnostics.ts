import {
  isStartupDiagnosticsEnabled,
  writeStartupDiagnosticLine
} from './startup/startup-diagnostics'
import type { QuitTeardownObserver } from './quit-teardown-deadline'

// Why 5 s: E2E force-kills a quit at 10 s, before the 20 s deadline warning
// can print, so the pending list must land on stderr well inside that (ORCA-992).
export const QUIT_TEARDOWN_PENDING_REPORT_MS = 5_000

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
    .join('')
}

/** `[shutdown]` stderr milestone under ORCA_STARTUP_DIAGNOSTICS; `t` is ms since process start. */
export function logQuitMilestone(event: string, details: Record<string, unknown> = {}): void {
  if (!isStartupDiagnosticsEnabled()) {
    return
  }
  writeStartupDiagnosticLine(
    `[shutdown] ${event}${formatDetails({ t: Math.round(performance.now()), ...details })}`
  )
}

export function createQuitTeardownDiagnosticsObserver(
  env: NodeJS.ProcessEnv = process.env
): QuitTeardownObserver {
  if (!isStartupDiagnosticsEnabled(env)) {
    return {}
  }
  return {
    memberSettled: (name, elapsedMs, outcome) =>
      logQuitMilestone('teardown-member-settled', { name, elapsedMs, outcome }),
    stillPending: (pending, elapsedMs) =>
      logQuitMilestone('teardown-members-pending', { pending, elapsedMs }),
    pendingReportMs: QUIT_TEARDOWN_PENDING_REPORT_MS
  }
}
