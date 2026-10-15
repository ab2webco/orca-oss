import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PROCESS_TABLE_TIMEOUT_MS = 1_000
const PROCESS_TABLE_MAX_BYTES = 1024 * 1024

type ProcessRow = {
  pid: number
  pgid: number
  tty: string
}

export type PosixPtyProcessGroupTerminationDeps = {
  platform?: NodeJS.Platform
  currentPid?: number
  readProcessTable?: () => string
  signalProcessGroup?: (pgid: number) => void
  /** Linux session id of a pid, or null when unreadable. */
  readProcessSessionId?: (pid: number) => number | null
}

/** Field 6 (`session`) of `/proc/<pid>/stat`, read past the parenthesised comm. */
export function parseLinuxProcStatSessionId(stat: string): number | null {
  const closingParen = stat.lastIndexOf(')')
  if (closingParen === -1) {
    return null
  }
  const session = Number(
    stat
      .slice(closingParen + 1)
      .trim()
      .split(/\s+/)[3]
  )
  return Number.isSafeInteger(session) && session > 0 ? session : null
}

function readLinuxProcessSessionId(pid: number): number | null {
  try {
    return parseLinuxProcStatSessionId(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return null
  }
}

function runPs(args: string[]): string {
  return execFileSync('ps', args, {
    encoding: 'utf8',
    timeout: PROCESS_TABLE_TIMEOUT_MS,
    maxBuffer: PROCESS_TABLE_MAX_BYTES
  })
}

function readPtyProcessTable(rootPid: number): string {
  const root = runPs(['-p', String(rootPid), '-o', 'pid=,pgid=,tty='])
  const rootRow = parseProcessRows(root).find((row) => row.pid === rootPid)
  if (!rootRow || rootRow.tty === '?' || rootRow.tty === '??') {
    return root
  }
  // Why: a whole-host `ps -ax` takes nearly a second on large machines. TTY
  // selection keeps forced terminal teardown proportional to one terminal.
  return `${root}\n${runPs(['-t', rootRow.tty, '-o', 'pid=,pgid=,tty='])}`
}

function parseProcessRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    const pgid = Number(match[2])
    if (pid > 0 && pgid > 1) {
      rows.push({ pid, pgid, tty: match[3] })
    }
  }
  return rows
}

export function getPosixPtyProcessGroups(
  output: string,
  rootPid: number,
  currentPid = process.pid,
  readSessionId?: (pid: number) => number | null
): number[] | null {
  const rows = parseProcessRows(output)
  const root = rows.find((row) => row.pid === rootPid)
  if (!root || root.tty === '?' || root.tty === '??') {
    return null
  }
  // Why: a development daemon can inherit its launch TTY. Never group-signal
  // when Orca itself shares the PTY; fall back to the already-scoped root kill.
  if (rows.some((row) => row.pid === currentPid && row.tty === root.tty)) {
    return null
  }
  let members = rows.filter((row) => row.tty === root.tty)
  if (readSessionId) {
    // Why: every devpts instance (e.g. each container) numbers ptys from 0, so a tty match alone
    // can name another namespace's session. The node-pty shell leads its own session.
    if (readSessionId(rootPid) !== rootPid) {
      return null
    }
    members = members.filter((row) => readSessionId(row.pid) === rootPid)
  }
  const groups = new Set(members.map((row) => row.pgid))
  if (!groups.has(root.pgid)) {
    return null
  }
  return [...groups].sort((left, right) => {
    if (left === root.pgid) {
      return 1
    }
    if (right === root.pgid) {
      return -1
    }
    return left - right
  })
}

function isProcessAlreadyGone(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ESRCH'
}

/** Force-kill every process group still attached to one POSIX PTY. */
export function forceKillPosixPtyProcessGroups(
  rootPid: number,
  fallback: () => void,
  deps: PosixPtyProcessGroupTerminationDeps = {}
): void {
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    fallback()
    return
  }
  let groups: number[] | null
  try {
    groups = getPosixPtyProcessGroups(
      (deps.readProcessTable ?? (() => readPtyProcessTable(rootPid)))(),
      rootPid,
      deps.currentPid ?? process.pid,
      deps.readProcessSessionId ?? (platform === 'linux' ? readLinuxProcessSessionId : undefined)
    )
  } catch {
    groups = null
  }
  if (!groups || groups.length === 0) {
    fallback()
    return
  }

  const signalProcessGroup =
    deps.signalProcessGroup ?? ((pgid: number) => process.kill(-pgid, 'SIGKILL'))
  let firstError: unknown
  for (const pgid of groups) {
    try {
      signalProcessGroup(pgid)
    } catch (error) {
      // Why: the PTY exit callback may reap a group between `ps` and killpg.
      // ESRCH is proof that this captured owner is already gone, not failure.
      if (!isProcessAlreadyGone(error) && firstError === undefined) {
        firstError = error
      }
    }
  }
  if (firstError !== undefined) {
    throw firstError
  }
}
