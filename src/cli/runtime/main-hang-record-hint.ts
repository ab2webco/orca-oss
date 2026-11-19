import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAIN_HANG_RECORD_DIR,
  MAIN_HANG_RECORD_RESOLVED_LINE,
  MAIN_HANG_RECORD_TIMEOUT_MS,
  mainHangRecordPath,
  mainHangRecordPrefix
} from '../../shared/main-hang-record'
import { writeMainThreadHangReport } from '../../main/hang-watchdog/main-thread-hang-report'
import { RuntimeClientError } from './types'

// Why: a hung runtime fails every CLI call; one capture per window is enough evidence.
const CLI_CAPTURE_INTERVAL_MS = 120_000

type HangRecord = { path: string; open: boolean; mtimeMs: number }
type HangRecordCapture = typeof writeMainThreadHangReport

function findNewestMainHangRecord(userDataPath: string, pid: number): HangRecord | null {
  const dir = join(userDataPath, MAIN_HANG_RECORD_DIR)
  try {
    const newest = readdirSync(dir)
      .filter((name) => name.startsWith(mainHangRecordPrefix(pid)) && name.endsWith('.txt'))
      .sort()
      .at(-1)
    if (!newest) {
      return null
    }
    const path = join(dir, newest)
    return {
      path,
      open: !readFileSync(path, 'utf8').includes(MAIN_HANG_RECORD_RESOLVED_LINE),
      mtimeMs: statSync(path).mtimeMs
    }
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Why: whoever hits the timeout should be able to attach the record without hunting for it.
export function withMainHangRecord(
  error: unknown,
  request: { userDataPath: string; pid: number; method: string; timeoutMs: number },
  capture: HangRecordCapture = writeMainThreadHangReport,
  now = Date.now()
): unknown {
  if (!(error instanceof RuntimeClientError) || error.code !== 'runtime_timeout') {
    return error
  }
  const { userDataPath, pid } = request
  const newest = findNewestMainHangRecord(userDataPath, pid)
  let sentence: string
  let path: string | null = newest?.path ?? null
  if (newest?.open) {
    sentence = `Orca Lab recorded where its main process ${pid} waits in ${newest.path}; attach it when you report this.`
  } else if (newest && now - newest.mtimeMs < CLI_CAPTURE_INTERVAL_MS) {
    sentence = `The newest hang record for Orca Lab process ${pid}, ${newest.path}, ends with the main thread answering again.`
  } else if (request.timeoutMs < MAIN_HANG_RECORD_TIMEOUT_MS) {
    // Why: a short probe (agent hooks wait 1 s) timing out does not prove a hang; never sample for it.
    path = null
    sentence = `No open hang record for Orca Lab process ${pid} is in ${join(userDataPath, MAIN_HANG_RECORD_DIR)}.`
  } else {
    // Why: no open record means the main thread still beats its watchdog (the wait is inside a
    // request) or the whole process froze; a capture from here shows which.
    path = null
    const reportPath = mainHangRecordPath(userDataPath, pid, now)
    try {
      if (isProcessAlive(pid)) {
        capture({
          reportPath,
          parentPid: pid,
          unresponsiveMs: request.timeoutMs,
          detectedAt: now,
          observer: `the CLI's ${request.method} request`
        })
        path = reportPath
      }
    } catch {
      // Best-effort; the timeout itself is still the error to report.
    }
    sentence = path
      ? `The CLI recorded where Orca Lab's main process ${pid} was in ${path}; attach it when you report this.`
      : `No hang record for Orca Lab process ${pid} is in ${join(userDataPath, MAIN_HANG_RECORD_DIR)}.`
  }
  return new RuntimeClientError(error.code, `${error.message} ${sentence}`, {
    ...(error.data && typeof error.data === 'object' ? error.data : {}),
    mainHangRecordPath: path
  })
}
