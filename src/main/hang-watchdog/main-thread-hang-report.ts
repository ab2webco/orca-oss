import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MAIN_HANG_RECORD_RESOLVED_LINE } from '../../shared/main-hang-record'
import { redactString } from '../observability/redactor'

const MAX_RECORDS = 5
const MAX_PROCESS_ROWS = 200
const MAX_COMMAND_CHARS = 500
const SAMPLE_SECONDS = '3'
const CAPTURE_TIMEOUT_MS = 30_000
const PS_ARGS = ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'etime=', '-o', 'stat=', '-o', 'args=']
const WINDOWS_PROCESS_LIST =
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }'

export type HangReportDeps = {
  platform: NodeJS.Platform
  run: (file: string, args: string[]) => string
  readText: (path: string) => string
  listDir: (path: string) => string[]
}

const defaultDeps: HangReportDeps = {
  platform: process.platform,
  run: (file, args) =>
    execFileSync(file, args, {
      encoding: 'utf8',
      timeout: CAPTURE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      // Why: sample prints progress on stderr, which would otherwise land in Orca's own log.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }),
  readText: (path) => readFileSync(path, 'utf8'),
  listDir: (path) => readdirSync(path)
}

function describeError(error: unknown): string {
  return `(could not capture: ${error instanceof Error ? error.message : String(error)})`
}

// Why: a main thread parked in spawnSync/execSync leaves its child alive, which names the wait.
export function descendantProcessRows(listing: string, rootPid: number): string[] {
  const rows: { pid: number; ppid: number; line: string }[] = []
  for (const line of listing.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s/.exec(line)
    if (match) {
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), line: line.trim() })
    }
  }
  const found = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (!found.has(row.pid) && found.has(row.ppid)) {
        found.add(row.pid)
        grew = true
      }
    }
  }
  return rows
    .filter((row) => row.pid !== rootPid && found.has(row.pid))
    .filter((row) => !row.line.includes('pid= -o ppid=') && !row.line.includes('Win32_Process'))
    .slice(0, MAX_PROCESS_ROWS)
    .map((row) => redactString(row.line.slice(0, MAX_COMMAND_CHARS)))
}

function childProcessSection(pid: number, deps: HangReportDeps): string {
  try {
    const listing =
      deps.platform === 'win32'
        ? deps.run('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            WINDOWS_PROCESS_LIST
          ])
        : deps.run('ps', PS_ARGS)
    const rows = descendantProcessRows(listing, pid)
    return rows.length > 0 ? rows.join('\n') : '(none)'
  } catch (error) {
    return describeError(error)
  }
}

function linuxThreadSection(pid: number, deps: HangReportDeps): string {
  const taskDir = `/proc/${pid}/task`
  const read = (path: string): string => {
    try {
      return deps.readText(path).trim()
    } catch {
      return '?'
    }
  }
  try {
    return deps
      .listDir(taskDir)
      .map((tid) => {
        const dir = join(taskDir, tid)
        // Why: comm may contain spaces or parens, so the state is the field after the last ')'.
        const stat = read(join(dir, 'stat'))
        const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) || '?'
        const syscall = read(join(dir, 'syscall')).split(' ')[0]
        return `${tid} ${read(join(dir, 'comm'))} state=${state} wchan=${read(join(dir, 'wchan'))} syscall=${syscall}`
      })
      .join('\n')
  } catch (error) {
    return describeError(error)
  }
}

function nativeStackSection(pid: number, reportPath: string, deps: HangReportDeps): string {
  if (deps.platform === 'darwin') {
    const samplePath = `${reportPath}.sample`
    try {
      deps.run('/usr/bin/sample', [String(pid), SAMPLE_SECONDS, '-mayDie', '-file', samplePath])
      return deps.readText(samplePath)
    } catch (error) {
      return describeError(error)
    } finally {
      rmSync(samplePath, { force: true })
    }
  }
  if (deps.platform === 'linux') {
    return linuxThreadSection(pid, deps)
  }
  return '(not captured on this platform; the child processes above are what it was running)'
}

function pruneOldRecords(reportPath: string, now: number): void {
  const dir = dirname(reportPath)
  const names = readdirSync(dir)
  // Why: a force quit mid-sample leaves its scratch file; one older than a capture is orphaned.
  for (const name of names.filter((n) => n.startsWith('main-hang-') && n.endsWith('.sample'))) {
    const path = join(dir, name)
    if (now - statSync(path).mtimeMs > CAPTURE_TIMEOUT_MS) {
      rmSync(path, { force: true })
    }
  }
  const records = names
    .filter((name) => name.startsWith('main-hang-') && name.endsWith('.txt'))
    .map((name) => ({ path: join(dir, name), mtimeMs: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const record of records.slice(MAX_RECORDS)) {
    if (basename(record.path) !== basename(reportPath)) {
      rmSync(record.path, { force: true })
    }
  }
}

// Observation only: it reads the stalled process and never signals it.
export function writeMainThreadHangReport(
  options: {
    reportPath: string
    parentPid: number
    unresponsiveMs: number
    detectedAt: number
    /** What noticed the stall; the in-process watchdog by default. */
    observer?: string
  },
  deps: HangReportDeps = defaultDeps
): void {
  const { reportPath, parentPid } = options
  mkdirSync(dirname(reportPath), { recursive: true })
  // Why: write what is cheap first, so a capture that hangs or kills the worker still leaves a record.
  const header = [
    `Orca Lab main process ${parentPid} stopped answering ${options.observer ?? 'its main-thread heartbeat'}.`,
    `Detected at ${new Date(options.detectedAt).toISOString()}, after ${options.unresponsiveMs} ms without an answer.`,
    `Recorded by pid ${process.pid} on ${deps.platform} ${process.arch}, Node ${process.versions.node}, Electron ${process.versions.electron ?? 'none'}`,
    '',
    '== Child processes of the main process (pid ppid elapsed state command) ==',
    childProcessSection(parentPid, deps),
    '',
    '== Threads of the main process =='
  ]
  writeFileSync(reportPath, `${header.join('\n')}\n`)
  appendFileSync(reportPath, `${nativeStackSection(parentPid, reportPath, deps)}\n`)
  try {
    pruneOldRecords(reportPath, Date.now())
  } catch {
    // Why: retention is housekeeping; failing it must not lose the record just written.
  }
}

export function appendMainThreadHangResolution(reportPath: string, unresponsiveMs: number): void {
  appendFileSync(reportPath, `\n${MAIN_HANG_RECORD_RESOLVED_LINE} ${unresponsiveMs} ms.\n`)
}
