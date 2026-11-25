import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { isAbsolute } from 'node:path'
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

// Why: no cap, like Electron's relauncher. A quit can run past any cap (daemon checkpoints are 30 s
// each), and an early exec loses the single-instance lock and exits. A zombie already let go of it.
const WAIT_THEN_EXEC_SCRIPT =
  'while kill -0 "$1" 2>/dev/null && ! grep -qs "^State:[[:space:]]*Z" "/proc/$1/status"; do sleep 0.2; done; shift; exec "$@"'

// Why: process.execPath of an AppImage lives in its FUSE mount, which goes away with this process, so the
// waiter execs the AppImage file, whose runtime mounts it again. Validated as electron-updater does.
function relaunchExecutable(): string | null {
  const appImage = process.env.APPIMAGE
  if (!appImage) {
    return process.execPath
  }
  if (!isAbsolute(appImage) || appImage.includes('\0')) {
    return null
  }
  try {
    accessSync(appImage, constants.X_OK)
    return appImage
  } catch {
    return null
  }
}

function relaunchKeepingPrivilegeEscalation(): void {
  // Why: Electron starts its relauncher through Chromium's LaunchProcess, which sets
  // PR_SET_NO_NEW_PRIVS. The relaunched app inherits it, so the next update's setuid pkexec exits
  // 127 ("pkexec must be setuid root"), an AppImage's next update cannot run the setuid fusermount
  // its runtime mounts with, and sudo in its terminals refuses to run (ORCA-1349).
  const executable = process.platform === 'linux' ? relaunchExecutable() : null
  if (executable === null) {
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
        executable,
        ...process.argv.slice(1)
      ],
      // Electron's relauncher passes fds 0-2 through, so a .desktop launch keeps logging to the journal.
      { detached: true, stdio: 'inherit' }
    )
    // Why: a failed spawn emits 'error' only on a later tick, after callers that app.exit(0) right away
    // are gone; pid is unset in this tick. The listener keeps that late event from throwing.
    waiter.on('error', () => {})
    if (waiter.pid === undefined) {
      app.relaunch()
      return
    }
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
