import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MAIN_HANG_RECORD_DIR,
  MAIN_HANG_RECORD_RESOLVED_LINE,
  MAIN_HANG_RECORD_TIMEOUT_MS,
  mainHangRecordPath,
  mainHangRecordPrefix
} from '../../shared/main-hang-record'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { sendRequest } from './transport'
import { RuntimeClientError } from './types'

// Why: a hung runtime fails every CLI call; one record per window is enough, and an older one
// (a CLI snapshot never gets a closing line) says nothing about this timeout.
const RECORD_FRESH_MS = 120_000
const CAPTURE_ENTRY = 'main-hang-capture-entry.js'
const STATUS_CHECK_TIMEOUT_MS = 3_000

export type MainHangCaptureOptions = {
  reportPath: string
  parentPid: number
  unresponsiveMs: number
  detectedAt: number
  observer: string
}

export type MainHangRecordDeps = {
  /** True when the runtime answers a short status check. */
  probe: () => Promise<boolean>
  startCapture: (options: MainHangCaptureOptions) => void
  isAlive: (pid: number) => boolean
  now: () => number
}

type HangRecord = { path: string; open: boolean; mtimeMs: number }

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

// Why: any reply, even an error, shows the main thread still serves requests.
export async function answersStatusCheck(metadata: RuntimeMetadata): Promise<boolean> {
  try {
    await sendRequest(metadata, 'status.get', undefined, STATUS_CHECK_TIMEOUT_MS)
    return true
  } catch {
    return false
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

// Why detached: sample on an Electron process takes 4 to 20 s; the timed-out call returns now.
function startDetachedCapture(options: MainHangCaptureOptions): void {
  mkdirSync(dirname(options.reportPath), { recursive: true })
  // Why: the placeholder makes concurrent timeouts see a fresh record instead of capturing again.
  writeFileSync(options.reportPath, `Recording Orca Lab main process ${options.parentPid}...\n`)
  spawn(process.execPath, [join(__dirname, CAPTURE_ENTRY), JSON.stringify(options)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }).unref()
}

export function parseMainHangCaptureOptions(
  raw: string | undefined
): MainHangCaptureOptions | null {
  try {
    const value = JSON.parse(raw ?? '') as Partial<MainHangCaptureOptions>
    return typeof value.reportPath === 'string' &&
      Number.isInteger(value.parentPid) &&
      (value.parentPid ?? 0) > 0 &&
      Number.isFinite(value.unresponsiveMs) &&
      Number.isFinite(value.detectedAt) &&
      typeof value.observer === 'string'
      ? (value as MainHangCaptureOptions)
      : null
  } catch {
    return null
  }
}

function withSentence(error: RuntimeClientError, sentence: string, path: string | null) {
  return new RuntimeClientError(error.code, `${error.message} ${sentence}`, {
    ...(error.data && typeof error.data === 'object' ? error.data : {}),
    mainHangRecordPath: path
  })
}

// Why: whoever hits the timeout should be able to attach the record without hunting for it.
export async function withMainHangRecord(
  error: unknown,
  request: {
    userDataPath: string
    pid: number
    method: string
    timeoutMs: number
    /** False for a stream's idle timeout, which does not show that a request went unanswered. */
    mayCapture: boolean
  },
  deps: Partial<MainHangRecordDeps> & Pick<MainHangRecordDeps, 'probe'>
): Promise<unknown> {
  if (!(error instanceof RuntimeClientError) || error.code !== 'runtime_timeout') {
    return error
  }
  const { userDataPath, pid, method } = request
  const now = (deps.now ?? Date.now)()
  const newest = findNewestMainHangRecord(userDataPath, pid)
  if (newest && now - newest.mtimeMs < RECORD_FRESH_MS) {
    return newest.open
      ? withSentence(
          error,
          `Orca Lab recorded where its main process ${pid} waits in ${newest.path}; attach it when you report this.`,
          newest.path
        )
      : withSentence(
          error,
          `The newest hang record for Orca Lab process ${pid}, ${newest.path}, ends with the main thread answering again.`,
          newest.path
        )
  }
  // Why: a short probe (agent hooks wait 1 s) timing out does not show a hang; never probe or sample for it.
  if (!request.mayCapture || request.timeoutMs < MAIN_HANG_RECORD_TIMEOUT_MS) {
    return error
  }
  if (await deps.probe()) {
    return withSentence(
      error,
      `The runtime answered a status check right after, so its main thread is not stuck; the ${method} request itself did not finish.`,
      null
    )
  }
  if (!(deps.isAlive ?? isProcessAlive)(pid)) {
    return withSentence(error, `Orca Lab process ${pid} is no longer running.`, null)
  }
  const reportPath = mainHangRecordPath(userDataPath, pid, now)
  try {
    ;(deps.startCapture ?? startDetachedCapture)({
      reportPath,
      parentPid: pid,
      unresponsiveMs: request.timeoutMs,
      detectedAt: now,
      observer: `the CLI's ${method} request or a status check after it`
    })
  } catch {
    return withSentence(error, `The CLI could not start recording Orca Lab process ${pid}.`, null)
  }
  return withSentence(
    error,
    `The CLI is recording where Orca Lab's main process ${pid} waits in ${reportPath} (done within about 30 s); attach it when you report this.`,
    reportPath
  )
}
