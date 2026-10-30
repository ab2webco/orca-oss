import { execFile } from 'node:child_process'
import { readdir, readlink, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, sep } from 'node:path'
import type { ProcessTableCapture, ProcessTableRow } from '../pty-descendant-termination'

// Why: shared with the SSH relay, which still targets Node 18 — keep to Node 18 APIs.

const SCAN_TIMEOUT_MS = 5_000
const PS_MAX_BUFFER_BYTES = 32 * 1024 * 1024
// ps -o lstart under LC_ALL=C is fixed-shape ("Tue Oct  7 08:37:00 2026"), so the free-form
// args column can follow it.
const PS_ROW =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s?(.*)$/

export type ProcessRow = ProcessTableRow & { uid: number; command: string }
export type CwdProcessRow = ProcessRow & { cwd: string }

export type CwdProcessScan =
  | { supported: true; capturedAtMs: number; table: ProcessRow[]; inside: CwdProcessRow[] }
  | { supported: false; reason: string }

export type CwdProcessScanDeps = {
  platform?: NodeJS.Platform
  readProcessRows?: () => Promise<ProcessTableCapture & { rows: ProcessRow[] }>
  readCwds?: () => Promise<Map<number, string>>
}

export function parseProcessRows(psOutput: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of psOutput.split('\n')) {
    const match = line.match(PS_ROW)
    if (!match) {
      continue
    }
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      uid: Number(match[4]),
      startedAt: match[5],
      command: match[6].trim()
    })
  }
  return rows
}

function execText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf-8',
        maxBuffer: PS_MAX_BUFFER_BYTES,
        timeout: SCAN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' }
      },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout)))
    )
  })
}

export async function readProcessRows(): Promise<ProcessTableCapture & { rows: ProcessRow[] }> {
  const capturedAtMs = Date.now()
  const stdout = await execText('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,uid=,lstart=,args='])
  return { rows: parseProcessRows(stdout), capturedAtMs }
}

/** lsof -F output: `p<pid>` opens a process block, `n<path>` is its cwd. */
export function parseLsofCwds(lsofOutput: string): Map<number, string> {
  const cwds = new Map<number, string>()
  let pid: number | null = null
  for (const line of lsofOutput.split('\n')) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1))
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null
    } else if (line.startsWith('n') && pid !== null && !cwds.has(pid)) {
      cwds.set(pid, line.slice(1))
    }
  }
  return cwds
}

async function readCwdsFromProc(): Promise<Map<number, string>> {
  const cwds = new Map<number, string>()
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name))
  await Promise.all(
    pids.map(async (pid) => {
      try {
        cwds.set(Number(pid), await readlink(`/proc/${pid}/cwd`))
      } catch {
        /* exited, or not ours */
      }
    })
  )
  return cwds
}

async function readCwdsWithLsof(): Promise<Map<number, string>> {
  // Why: lsof exits 1 when some processes are unreadable but still prints the readable ones.
  const stdout = await execText('lsof', ['-w', '-d', 'cwd', '-Fpn']).catch(
    (error: { stdout?: unknown }) => {
      if (typeof error.stdout === 'string' && error.stdout.length > 0) {
        return error.stdout
      }
      throw error
    }
  )
  return parseLsofCwds(stdout)
}

export function isPathInside(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** A sweep root must be narrower than home: `/` or `~` would match every process the user runs. */
export function isSweepableRoot(root: string, home = homedir()): boolean {
  return root !== dirname(root) && !isPathInside(home, root)
}

/** Every process whose cwd is inside `root`, joined with one process-table read. */
export async function scanCwdProcesses(
  root: string,
  deps: CwdProcessScanDeps = {}
): Promise<CwdProcessScan> {
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    return { supported: false, reason: 'per-process cwd is not readable on Windows' }
  }
  let resolvedRoot: string
  try {
    resolvedRoot = await realpath(root)
  } catch {
    return { supported: false, reason: `cannot resolve ${root}` }
  }
  const readCwds = deps.readCwds ?? (platform === 'linux' ? readCwdsFromProc : readCwdsWithLsof)
  try {
    const [cwds, capture] = await Promise.all([
      readCwds(),
      (deps.readProcessRows ?? readProcessRows)()
    ])
    const inside: CwdProcessRow[] = []
    for (const row of capture.rows) {
      const cwd = cwds.get(row.pid)
      if (cwd !== undefined && isPathInside(cwd, resolvedRoot)) {
        inside.push({ ...row, cwd })
      }
    }
    return { supported: true, capturedAtMs: capture.capturedAtMs, table: capture.rows, inside }
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

const LSTART_SKEW_MS = 2_000

export type OrphanSelection = {
  notBeforeMs: number
  uid: number
  selfPid: number
}

function isOrphanParent(parent: ProcessRow, uid: number): boolean {
  // Why: Linux desktops reparent orphans to the `systemd --user` subreaper, not pid 1.
  return (
    parent.pid === 1 || (parent.uid === uid && basename(parent.command.split(' ')[0]) === 'systemd')
  )
}

/**
 * The processes an ended session left behind: cwd inside its root, same user, started no earlier
 * than the session, and orphaned — every ancestor up to init or the subreaper is itself such a
 * process. A process with any other live ancestor (an editor, another terminal, Orca itself)
 * still has an owner and is never selected. Their descendants come along whatever their cwd.
 */
export function selectSessionOrphans(
  scan: Extract<CwdProcessScan, { supported: true }>,
  selection: OrphanSelection
): ProcessRow[] {
  const byPid = new Map<number, ProcessRow>()
  for (const row of scan.table) {
    byPid.set(row.pid, row)
  }
  const selfAndAncestors = new Set<number>()
  for (let row = byPid.get(selection.selfPid); row && !selfAndAncestors.has(row.pid); ) {
    selfAndAncestors.add(row.pid)
    row = byPid.get(row.ppid)
  }
  // Why: Linux lstart reads up to ~1s early (second-truncated boot time, measured on Linux CI), so
  // a poller started just after the session can fall before its start second.
  const notBefore = Math.floor((selection.notBeforeMs - LSTART_SKEW_MS) / 1_000) * 1_000
  const candidates = new Set<number>()
  for (const row of scan.inside) {
    const startedAtMs = Date.parse(row.startedAt)
    if (
      row.uid === selection.uid &&
      Number.isFinite(startedAtMs) &&
      startedAtMs >= notBefore &&
      !selfAndAncestors.has(row.pid)
    ) {
      candidates.add(row.pid)
    }
  }
  const selected = new Map<number, ProcessRow>()
  for (const pid of candidates) {
    let row = byPid.get(pid)
    const seen = new Set<number>()
    while (row && candidates.has(row.ppid) && !seen.has(row.pid)) {
      seen.add(row.pid)
      row = byPid.get(row.ppid)
    }
    const parent = row ? byPid.get(row.ppid) : undefined
    if (row && parent && isOrphanParent(parent, selection.uid)) {
      selected.set(pid, byPid.get(pid) as ProcessRow)
    }
  }
  const childrenByPpid = new Map<number, ProcessRow[]>()
  for (const row of scan.table) {
    const siblings = childrenByPpid.get(row.ppid)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenByPpid.set(row.ppid, [row])
    }
  }
  const queue = [...selected.keys()]
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of childrenByPpid.get(queue[index]) ?? []) {
      if (
        !selected.has(child.pid) &&
        child.uid === selection.uid &&
        !selfAndAncestors.has(child.pid)
      ) {
        selected.set(child.pid, child)
        queue.push(child.pid)
      }
    }
  }
  return [...selected.values()]
}
