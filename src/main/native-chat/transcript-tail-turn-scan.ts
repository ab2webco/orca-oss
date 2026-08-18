// Walks a session log backwards looking only for the newest turn boundary.
//
// Why not the message tail reader: its backward walk stops once it has decoded
// `limit` messages, and in an agentic turn the boundary sits at the *start* of
// the turn — one 520-message turn measured here puts it far outside any message
// budget. Lifecycle records are cheap to decode and build no messages, so this
// scan is bounded by bytes and reports when it spent them without finding one.

import { open, stat } from 'node:fs/promises'
import type { NativeChatTurnLifecycle } from '../../shared/native-chat-types'
import { MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES } from './transcript-tail-reader'
import { transcriptFallbackId } from './transcript-fallback-id'
import type { NativeChatTurnLifecycleDecoder } from './transcript-turn-lifecycle'
import {
  decodeTranscriptQueuedInput,
  type TranscriptQueuedInputOperation
} from './transcript-queued-input'

const CHUNK_BYTES = 64 * 1024
// The widest boundary-free stretch measured across this repo's six largest real
// transcripts is 5.9 MB / 741 records; 16 MB keeps ~2.7x margin over it.
export const DEFAULT_TURN_SCAN_BYTES = 16 * 1024 * 1024

export type TranscriptTailTurnScan = {
  /** Newest turn boundary in the scanned window. */
  lifecycle: NativeChatTurnLifecycle | null
  /** Queued-input records seen in the window, newest first. */
  queuedOperations: TranscriptQueuedInputOperation[]
  unparsedRecords: number
  /** True when the byte ceiling ran out before any boundary was found. */
  reachedCeiling: boolean
}

export async function scanTranscriptTailForTurn(
  filePath: string,
  decodeLifecycle: NativeChatTurnLifecycleDecoder,
  maxScanBytes: number = DEFAULT_TURN_SCAN_BYTES
): Promise<TranscriptTailTurnScan> {
  const size = (await stat(filePath)).size
  const scan: TranscriptTailTurnScan = {
    lifecycle: null,
    queuedOperations: [],
    unparsedRecords: 0,
    reachedCeiling: false
  }
  if (size === 0) {
    return scan
  }

  const handle = await open(filePath, 'r')
  try {
    const finalByte = Buffer.allocUnsafe(1)
    await handle.read(finalByte, 0, 1, size - 1)
    const endsWithNewline = finalByte[0] === 0x0a
    // A transcript being appended to right now has a torn last line; it is not a
    // malformed record and must not be counted as one.
    let skipTornTail = !endsWithNewline
    let cursor = size - (endsWithNewline ? 1 : 0)
    // Fragments of the line that continues into regions already read, in file
    // order. Concatenated once, when the line's first byte finally shows up.
    let carryParts: Buffer[] = []
    let carryBytes = 0
    let scanned = 0

    while (cursor > 0) {
      if (scanned >= maxScanBytes) {
        scan.reachedCeiling = true
        return scan
      }
      const start = Math.max(0, cursor - CHUNK_BYTES)
      const buffer = Buffer.allocUnsafe(cursor - start)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      scanned += bytesRead
      const chunk = buffer.subarray(0, bytesRead)
      let segmentEnd = chunk.length
      for (let index = chunk.length - 1; index >= 0; index--) {
        if (chunk[index] !== 0x0a) {
          continue
        }
        const fragment = chunk.subarray(index + 1, segmentEnd)
        segmentEnd = index
        if (skipTornTail) {
          skipTornTail = false
          carryParts = []
          carryBytes = 0
          continue
        }
        const line = carryParts.length > 0 ? Buffer.concat([fragment, ...carryParts]) : fragment
        carryParts = []
        carryBytes = 0
        if (consume(line, start + index + 1)) {
          return scan
        }
      }
      if (segmentEnd > 0) {
        carryParts.unshift(chunk.subarray(0, segmentEnd))
        carryBytes += segmentEnd
        if (carryBytes > MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) {
          scan.unparsedRecords += 1
          carryParts = []
          carryBytes = 0
        }
      }
      cursor = start
    }
    if (carryParts.length > 0 && !skipTornTail) {
      consume(Buffer.concat(carryParts), 0)
    }
    return scan

    /** Returns true once the boundary is found and the scan can stop. */
    function consume(raw: Buffer, offset: number): boolean {
      const line = raw.toString('utf8').replace(/\r$/, '').trim()
      if (!line) {
        return false
      }
      const queued = decodeTranscriptQueuedInput(line)
      if (queued) {
        scan.queuedOperations.push(queued)
        return false
      }
      const lifecycle = decodeLifecycle(line, transcriptFallbackId(filePath, offset))
      if (lifecycle) {
        scan.lifecycle = lifecycle
        return true
      }
      if (!line.startsWith('{')) {
        scan.unparsedRecords += 1
      }
      return false
    }
  } finally {
    await handle.close()
  }
}
