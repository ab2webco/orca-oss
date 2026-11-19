import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createHangWatchdogDetectionLoop } from './hang-watchdog-detection-loop'
import { writeHangDetectionMarker } from './hang-detection-marker'
import {
  appendMainThreadHangResolution,
  writeMainThreadHangReport
} from './main-thread-hang-report'
import { mainHangRecordPath } from '../../shared/main-hang-record'
import type {
  HangWatchdogWorkerData,
  MainToHangWatchdogWorkerMessage
} from './hang-watchdog-worker-protocol'

type HangWatchdogPort = {
  on: (event: 'message', listener: (message: MainToHangWatchdogWorkerMessage) => void) => unknown
  close: () => void
}

// Observation only: a false positive must never kill a live main thread mid-write.
export function recordHangObservation(options: {
  parentPid: number
  markerPath: string
  unresponsiveMs: number
  selfRecovered: boolean
  reportPath?: string
}): void {
  if (!options.markerPath) {
    return
  }
  try {
    writeHangDetectionMarker(options.markerPath, {
      detectedAt: Date.now(),
      parentPid: options.parentPid,
      unresponsiveMs: options.unresponsiveMs,
      selfRecovered: options.selfRecovered,
      ...(options.reportPath ? { reportPath: options.reportPath } : {})
    })
  } catch {
    // Why: telemetry is best-effort; a marker that cannot be written must not take down the watchdog.
  }
}

export function runWatchdog(
  config: HangWatchdogWorkerData,
  port: HangWatchdogPort | null = parentPort
): void {
  if (!port) {
    return
  }
  let reportPath: string | undefined
  const loop = createHangWatchdogDetectionLoop({
    timeoutMs: config.timeoutMs,
    checkIntervalMs: config.checkIntervalMs,
    now: () => Date.now(),
    onHangDetected: (unresponsiveMs) => {
      const detectedAt = Date.now()
      reportPath = config.userDataPath
        ? mainHangRecordPath(config.userDataPath, config.parentPid, detectedAt)
        : undefined
      // Why: the marker goes first so a capture that takes the worker down still leaves it.
      recordHangObservation({
        parentPid: config.parentPid,
        markerPath: config.markerPath,
        unresponsiveMs,
        selfRecovered: false,
        reportPath
      })
      if (reportPath) {
        try {
          writeMainThreadHangReport({
            reportPath,
            parentPid: config.parentPid,
            unresponsiveMs,
            detectedAt
          })
        } catch {
          // Why: best-effort like the marker; the watchdog keeps running without a record.
        }
      }
    },
    // Why: rewriting the marker keeps one observation per stall rather than two rows to reconcile.
    onHangResolved: (unresponsiveMs) => {
      recordHangObservation({
        parentPid: config.parentPid,
        markerPath: config.markerPath,
        unresponsiveMs,
        selfRecovered: true,
        reportPath
      })
      if (reportPath) {
        try {
          appendMainThreadHangResolution(reportPath, unresponsiveMs)
        } catch {
          // Record missing or unwritable; the marker still says the stall cleared.
        }
      }
    }
  })

  let checkTimer: ReturnType<typeof setInterval> | null = setInterval(
    () => loop.tick(),
    config.checkIntervalMs
  )
  port.on('message', (message: MainToHangWatchdogWorkerMessage) => {
    if (message.type === 'heartbeat') {
      loop.recordHeartbeat()
    } else if (message.type === 'shutdown') {
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = null
      }
      port.close()
    }
  })
}

export function isHangWatchdogWorkerData(value: unknown): value is HangWatchdogWorkerData {
  const data = value as Partial<HangWatchdogWorkerData> | null
  return (
    !!data &&
    Number.isInteger(data.parentPid) &&
    (data.parentPid ?? 0) > 0 &&
    typeof data.markerPath === 'string' &&
    typeof data.userDataPath === 'string' &&
    Number.isFinite(data.timeoutMs) &&
    (data.timeoutMs ?? 0) > 0 &&
    Number.isFinite(data.checkIntervalMs) &&
    (data.checkIntervalMs ?? 0) > 0
  )
}

if (!isMainThread && isHangWatchdogWorkerData(workerData)) {
  runWatchdog(workerData)
}
