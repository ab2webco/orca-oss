import { MAIN_HANG_RECORD_TIMEOUT_MS } from '../../shared/main-hang-record'

export const HANG_WATCHDOG_HEARTBEAT_INTERVAL_MS = 2_000
export const HANG_WATCHDOG_TIMEOUT_MS = MAIN_HANG_RECORD_TIMEOUT_MS
export const HANG_WATCHDOG_CHECK_INTERVAL_MS = 5_000

export type HangWatchdogWorkerData = {
  parentPid: number
  markerPath: string
  /** Where the hang record goes, under `logs/`; empty skips the record. */
  userDataPath: string
  timeoutMs: number
  checkIntervalMs: number
}

export type MainToHangWatchdogWorkerMessage =
  /** sentAt: main's clock, so a heartbeat queued behind a capture does not stretch the stall. */
  { type: 'heartbeat'; sentAt?: number } | { type: 'shutdown' }
