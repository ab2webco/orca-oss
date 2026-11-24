import { spawn } from 'node:child_process'
import { app } from 'electron'
import type { CrashReportBreadcrumbData } from '../shared/crash-reporting'
import { recordDurableCrashBreadcrumb } from './crash-reporting/durable-crash-breadcrumb'

export type AppRelaunchReason =
  | 'admin-restart'
  | 'gpu-fallback'
  | 'profile-switch'
  | 'profile-transfer'
  | 'renderer-request'
  | 'update-install'

// Waits up to 30 s for the old process (single-instance lock) to exit, then execs the app.
const WAIT_THEN_EXEC_SCRIPT =
  'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i+1)); done; shift; exec "$@"'

function relaunchKeepingPrivilegeEscalation(): void {
  // Why: Electron starts its relauncher through Chromium's LaunchProcess, which sets
  // PR_SET_NO_NEW_PRIVS. The relaunched app inherits it, so the next update's setuid pkexec exits
  // 127 ("pkexec must be setuid root") and sudo in its terminals refuses to run (ORCA-1349).
  // AppImage keeps Electron's path: its mount lives only as long as this process.
  if (process.platform !== 'linux' || process.env.APPIMAGE) {
    app.relaunch()
    return
  }
  try {
    const waiter = spawn(
      '/bin/sh',
      [
        '-c',
        WAIT_THEN_EXEC_SCRIPT,
        'orca-relaunch',
        String(process.pid),
        process.execPath,
        ...process.argv.slice(1)
      ],
      { detached: true, stdio: 'ignore' }
    )
    waiter.on('error', () => app.relaunch())
    waiter.unref()
  } catch {
    app.relaunch()
  }
}

export function relaunchApp(reason: AppRelaunchReason, data?: CrashReportBreadcrumbData): void {
  // Why: the current process can exit immediately after app.relaunch(), so
  // persist the cause before Electron schedules the replacement process.
  recordDurableCrashBreadcrumb('app_relaunch_requested', { ...data, reason })
  relaunchKeepingPrivilegeEscalation()
}
