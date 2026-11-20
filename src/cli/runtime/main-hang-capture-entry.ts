import { writeMainThreadHangReport } from '../../main/hang-watchdog/main-thread-hang-report'
import { parseMainHangCaptureOptions } from './main-hang-record-hint'

// Spawned detached by a timed-out CLI call, so the call does not wait for sample.
const options = parseMainHangCaptureOptions(process.argv[2])
if (options) {
  try {
    writeMainThreadHangReport(options)
  } catch {
    // Best-effort; the placeholder record stays to say a capture was attempted.
  }
}
