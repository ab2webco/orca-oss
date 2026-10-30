import { realpath } from 'node:fs/promises'
import { terminateDescendantSnapshot, type SignalSender } from '../pty-descendant-termination'
import {
  isSweepableRoot,
  readProcessRows,
  scanCwdProcesses,
  selectSessionOrphans,
  type CwdProcessScanDeps
} from './worktree-cwd-processes'

export type EndedSessionOrphanSweepDeps = CwdProcessScanDeps & {
  sendSignal?: SignalSender
  graceMs?: number
  home?: string
}

export type EndedSessionOrphanSweepResult =
  | { status: 'swept'; pids: number[] }
  | { status: 'skipped'; reason: string }

/**
 * After an agent session's root exits, terminates what it left orphaned in its worktree (ORCA-678):
 * double-forked or setsid pollers that no ppid walk from the root can reach. Never throws, so it
 * can never block or fail a close; an unsupported platform or failed scan is a skip.
 */
export async function sweepEndedSessionOrphans(
  root: string,
  sessionStartedAtMs: number,
  deps: EndedSessionOrphanSweepDeps = {}
): Promise<EndedSessionOrphanSweepResult> {
  try {
    const uid = process.getuid?.()
    if (uid === undefined) {
      return { status: 'skipped', reason: 'no POSIX uid' }
    }
    const resolvedRoot = await realpath(root).catch(() => root)
    if (!isSweepableRoot(resolvedRoot, deps.home)) {
      return { status: 'skipped', reason: `refusing to sweep ${resolvedRoot}` }
    }
    const scan = await scanCwdProcesses(resolvedRoot, deps)
    if (!scan.supported) {
      return { status: 'skipped', reason: scan.reason }
    }
    const orphans = selectSessionOrphans(scan, {
      notBeforeMs: sessionStartedAtMs,
      uid,
      selfPid: process.pid
    })
    // Why: reuse the descendant terminator so SIGKILL keeps its pid + lstart + pgid identity gate.
    terminateDescendantSnapshot(
      { rootPgid: null, descendants: orphans, capturedAtMs: scan.capturedAtMs },
      {
        readTable: deps.readProcessRows ?? readProcessRows,
        ...(deps.sendSignal ? { sendSignal: deps.sendSignal } : {}),
        ...(deps.graceMs !== undefined ? { graceMs: deps.graceMs } : {})
      }
    )
    return { status: 'swept', pids: orphans.map((row) => row.pid) }
  } catch (error) {
    return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
  }
}
