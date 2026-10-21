import { createLocalFileSink, type LocalFileSink } from '../observability/local-file-sink'
import type { MemoryPressurePopupRecord } from './memory-pressure-monitor'
import type { MemoryPressurePopupLog } from './memory-pressure-service'

const POPUP_LOG_MAX_BYTES = 1024 * 1024
const POPUP_LOG_MAX_FILES = 2

/**
 * One NDJSON line per popup shown, plus the popups the old rule would have shown, so a working
 * day can be compared before and after. Opened lazily: most sessions never write a line.
 */
export function createMemoryPressurePopupLog(filePath: string): MemoryPressurePopupLog {
  let sink: LocalFileSink | null = null
  let failed = false
  return {
    push: (record: MemoryPressurePopupRecord) => {
      if (failed) {
        return
      }
      try {
        sink ??= createLocalFileSink({
          filePath,
          maxBytes: POPUP_LOG_MAX_BYTES,
          maxFiles: POPUP_LOG_MAX_FILES
        })
        sink.push(record)
      } catch {
        // A read-only profile must not break the warning itself.
        failed = true
      }
    },
    close: () => {
      try {
        sink?.close()
      } catch {
        // Closing at shutdown is best effort.
      }
      sink = null
    }
  }
}
