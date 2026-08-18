// Queued-input records, the one agent-state signal the turn-lifecycle decoders
// do not carry. Claude writes `queue-operation`; a real Codex rollout has no
// equivalent record, so the capability is reported rather than assumed.

import type { AgentType } from '../../shared/native-chat-types'
import { resolveNativeChatTranscriptAgent } from '../../shared/native-chat-agent-support'
import { extractString, parseJsonObject, timestampMs } from '../ai-vault/session-scanner-values'

export type TranscriptQueuedInputOperation = {
  operation: 'enqueue' | 'remove'
  timestamp: number | null
}

export const QUEUED_INPUT_UNSUPPORTED_REASON =
  'this agent writes no queued-input records to its session log'

export function transcriptAgentWritesQueuedInput(agent: AgentType): boolean {
  return resolveNativeChatTranscriptAgent(agent) === 'claude'
}

export function decodeTranscriptQueuedInput(line: string): TranscriptQueuedInputOperation | null {
  const record = parseJsonObject(line)
  if (record?.type !== 'queue-operation') {
    return null
  }
  const operation = extractString(record.operation)
  if (operation !== 'enqueue' && operation !== 'remove') {
    return null
  }
  const parsed = timestampMs(record.timestamp)
  return { operation, timestamp: Number.isFinite(parsed) ? parsed : null }
}

/** Enqueues net of removes in the scanned window; a window that cuts a pair
 *  mid-way can only under-count, never report phantom queued input. */
export function pendingQueuedInputCount(operations: TranscriptQueuedInputOperation[]): number {
  let pending = 0
  for (const entry of operations) {
    pending = entry.operation === 'enqueue' ? pending + 1 : Math.max(0, pending - 1)
  }
  return pending
}
