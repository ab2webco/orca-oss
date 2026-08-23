// Walks a session log backwards looking only for the newest turn boundary.
//
// Why not the message tail reader: its backward walk stops once it has decoded
// `limit` messages, and in an agentic turn the boundary sits at the *start* of
// the turn — one 520-message turn measured here puts it far outside any message
// budget. Lifecycle records are cheap to decode and build no messages, so this
// scan is bounded by bytes and reports when it spent them without finding one.

import { open, stat } from 'node:fs/promises'
import type { AgentSessionLogActivity } from '../../shared/agent-session-log-state'
import type { NativeChatTurnLifecycle } from '../../shared/native-chat-types'
import { MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES } from './transcript-tail-reader'
import { transcriptFallbackId } from './transcript-fallback-id'
import type { NativeChatTurnLifecycleDecoder } from './transcript-turn-lifecycle'
import { decodeTranscriptModelUsage, type TranscriptModelUsage } from './transcript-model-usage'
import {
  decodeTranscriptQueuedInput,
  type TranscriptQueuedInputOperation
} from './transcript-queued-input'
import type { NativeChatLineDecoder } from './transcript-tail-reader'
import {
  TranscriptActivityAccumulator,
  transcriptActivityRecord
} from './transcript-activity-scan'

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
  /** Only collected when the caller passed an activity decoder. */
  activity: AgentSessionLogActivity | null
  /** Newest assistant turn's model and context size, when the tail had one. */
  modelUsage: TranscriptModelUsage | null
}

export async function scanTranscriptTailForTurn(
  filePath: string,
  decodeLifecycle: NativeChatTurnLifecycleDecoder,
  maxScanBytes: number = DEFAULT_TURN_SCAN_BYTES,
  decodeActivity?: NativeChatLineDecoder | null
): Promise<TranscriptTailTurnScan> {
  const size = (await stat(filePath)).size
  const activity = decodeActivity ? new TranscriptActivityAccumulator() : null
  const scan: TranscriptTailTurnScan = {
    lifecycle: null,
    queuedOperations: [],
    unparsedRecords: 0,
    reachedCeiling: false,
    activity: null,
    modelUsage: null
  }
  if (size === 0) {
    return finish()
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
        return finish()
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
          return finish()
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
    return finish()

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
      const fallbackId = transcriptFallbackId(filePath, offset)
      // Before the boundary check, not after: on a settled transcript the newest
      // lifecycle row IS the last assistant row, so deferring this would leave
      // every idle agent's cell blank.
      collectActivity(line, fallbackId)
      // First one wins: walking backwards, that is the newest turn. Stopping
      // here keeps this free — the scan was reading the row anyway.
      scan.modelUsage ??= decodeTranscriptModelUsage(line)
      const lifecycle = decodeLifecycle(line, fallbackId)
      if (lifecycle) {
        scan.lifecycle = lifecycle
        return true
      }
      if (!line.startsWith('{')) {
        scan.unparsedRecords += 1
      }
      return false
    }

    function collectActivity(line: string, fallbackId: string): void {
      if (!activity || !decodeActivity || !activity.wants || !activity.spend()) {
        return
      }
      const message = decodeActivity(line, fallbackId)
      if (!message) {
        return
      }
      const record = transcriptActivityRecord(message)
      if (record) {
        activity.push(record)
      }
    }
  } finally {
    await handle.close()
  }

  function finish(): TranscriptTailTurnScan {
    scan.activity = activity ? activity.result() : null
    return scan
  }
}
