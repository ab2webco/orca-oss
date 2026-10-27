import { realpath } from 'node:fs/promises'
import { terminateDescendantSnapshot, type SignalSender } from '../pty-descendant-termination'
import {
  isSweepableRoot,
  readProcessRows,
  scanCwdProcesses,
  selectSessionOrphans,
  type CwdProcessScanDeps,
  type ProcessRow
} from './worktree-cwd-processes'
import type {
  WorktreeProcessesOptions,
  WorktreeProcessesResult
} from '../../shared/worktree-processes'

// Why: shared with the SSH relay, which still targets Node 18 — keep to Node 18 APIs.

export type WorktreeProcessesDeps = CwdProcessScanDeps & {
  sendSignal?: SignalSender
  selfPid?: number
  home?: string
}

function withAncestors(pids: number[], table: ProcessRow[]): Set<number> {
  const byPid = new Map<number, ProcessRow>()
  for (const row of table) {
    byPid.set(row.pid, row)
  }
  const result = new Set<number>()
  for (const pid of pids) {
    for (let row = byPid.get(pid); row && !result.has(row.pid); row = byPid.get(row.ppid)) {
      result.add(row.pid)
    }
    result.add(pid)
  }
  return result
}

/**
 * Lists — and with `stop`, terminates — the processes whose cwd is inside a worktree or folder.
 * Only orphans are stoppable: a process with a live owner outside the folder (an open Orca
 * terminal or agent, an editor, Orca itself, the caller) is reported as protected instead.
 */
export async function listWorktreeProcesses(
  root: string,
  options: WorktreeProcessesOptions,
  deps: WorktreeProcessesDeps = {}
): Promise<WorktreeProcessesResult> {
  const resolvedRoot = await realpath(root).catch(() => root)
  if (options.stop && !isSweepableRoot(resolvedRoot, deps.home)) {
    return {
      supported: false,
      root: resolvedRoot,
      reason: `refusing to stop processes under ${resolvedRoot}: it contains the home folder`
    }
  }
  const scan = await scanCwdProcesses(resolvedRoot, deps)
  if (!scan.supported) {
    return { supported: false, root: resolvedRoot, reason: scan.reason }
  }
  const processes = scan.inside.map((row) => ({
    pid: row.pid,
    ppid: row.ppid,
    command: row.command,
    cwd: row.cwd,
    startedAt: row.startedAt
  }))
  const selfPid = deps.selfPid ?? process.pid
  const guarded = withAncestors(
    [selfPid, ...(options.callerPid ? [options.callerPid] : [])],
    scan.table
  )
  const uid = process.getuid?.()
  const targets =
    uid === undefined
      ? []
      : selectSessionOrphans(
          { ...scan, inside: scan.inside.filter((row) => !guarded.has(row.pid)) },
          { notBeforeMs: 0, uid, selfPid }
        ).filter((row) => !guarded.has(row.pid))
  const targetPids = new Set(targets.map((row) => row.pid))
  const protectedPids = processes.filter((p) => !targetPids.has(p.pid)).map((p) => p.pid)
  if (!options.stop) {
    return { supported: true, root: resolvedRoot, processes, stopped: [], protected: protectedPids }
  }
  terminateDescendantSnapshot(
    { rootPgid: null, descendants: targets, capturedAtMs: scan.capturedAtMs },
    {
      readTable: deps.readProcessRows ?? readProcessRows,
      ...(deps.sendSignal ? { sendSignal: deps.sendSignal } : {})
    }
  )
  return {
    supported: true,
    root: resolvedRoot,
    processes,
    stopped: targets.map((row) => row.pid),
    protected: protectedPids
  }
}
