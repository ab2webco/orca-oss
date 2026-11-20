import { join } from 'node:path'

// Why shared: the main-process watchdog writes these records and the CLI names them on a timeout.
export const MAIN_HANG_RECORD_DIR = 'logs'
export const MAIN_HANG_RECORD_TIMEOUT_MS = 30_000
export const MAIN_HANG_RECORD_RESOLVED_LINE = 'Main thread answered again after'

export function mainHangRecordPrefix(pid: number): string {
  return `main-hang-${pid}-`
}

export function mainHangRecordPath(userDataPath: string, pid: number, detectedAt: number): string {
  // Why: ISO time sorts lexically, so the newest record for a pid is the last name.
  const stamp = new Date(detectedAt).toISOString().replace(/[:.]/g, '-')
  return join(userDataPath, MAIN_HANG_RECORD_DIR, `${mainHangRecordPrefix(pid)}${stamp}.txt`)
}
