// What the agent is doing right now, read from the same backward tail walk that
// finds the turn boundary. Nothing here inspects a PTY buffer (ORCA-234/236).

import {
  isTextBlock,
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatMessage
} from '../../shared/native-chat-types'
import {
  AGENT_SESSION_LOG_ACTIVITY_TEXT_LIMIT,
  type AgentSessionLogActivity
} from '../../shared/agent-session-log-state'

/** Decoding a record into blocks costs far more than a lifecycle check, so the
 *  walk gives activity its own budget: spending it means "no prose in the window",
 *  never "the agent said nothing". */
export const TRANSCRIPT_ACTIVITY_RECORD_BUDGET = 400

export type TranscriptActivityRecord = {
  /** Assistant prose carried by this record, already collapsed. */
  text: string | null
  /** Tool this record invokes, if any. */
  toolName: string | null
  /** This record is a tool result: everything older has already returned. */
  isToolResult: boolean
  timestamp: number | null
}

export function transcriptActivityRecord(
  message: NativeChatMessage
): TranscriptActivityRecord | null {
  let text: string | null = null
  let toolName: string | null = null
  let isToolResult = false
  for (const block of message.blocks) {
    if (isToolResultBlock(block)) {
      isToolResult = true
      continue
    }
    if (isToolCallBlock(block)) {
      toolName = toolName ?? (block.name.trim() || null)
      continue
    }
    // Only the assistant's own prose answers "what is it doing": a user row is
    // the prompt, and a reasoning row is not what the agent reported.
    if (message.role === 'assistant' && isTextBlock(block)) {
      text = text ?? collapseActivityText(block.text)
    }
  }
  if (text === null && toolName === null && !isToolResult) {
    return null
  }
  return { text, toolName, isToolResult, timestamp: message.timestamp }
}

export function collapseActivityText(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return null
  }
  return collapsed.length > AGENT_SESSION_LOG_ACTIVITY_TEXT_LIMIT
    ? `${collapsed.slice(0, AGENT_SESSION_LOG_ACTIVITY_TEXT_LIMIT - 1).trimEnd()}…`
    : collapsed
}

/** Folds newest-first records into one activity reading. */
export class TranscriptActivityAccumulator {
  private text: string | null = null
  private toolName: string | null = null
  private toolSettled = false
  private atMs: number | null = null
  private spent = 0
  private budgetExhausted = false

  constructor(private readonly budget: number = TRANSCRIPT_ACTIVITY_RECORD_BUDGET) {}

  /** False once nothing more can be learned, so the walk stops decoding records. */
  get wants(): boolean {
    return !this.budgetExhausted && (this.text === null || !this.toolSettled)
  }

  spend(): boolean {
    if (this.budgetExhausted) {
      return false
    }
    this.spent += 1
    if (this.spent > this.budget) {
      this.budgetExhausted = true
      return false
    }
    return true
  }

  push(record: TranscriptActivityRecord): void {
    if (!this.toolSettled) {
      // Backward walk: a tool call met before any result is the one in flight;
      // a result met first means nothing is pending.
      if (record.isToolResult) {
        this.toolSettled = true
      } else if (record.toolName) {
        this.toolName = record.toolName
        this.toolSettled = true
      }
    }
    if (this.text === null && record.text) {
      this.text = record.text
    }
    if (this.atMs === null && record.timestamp !== null) {
      this.atMs = record.timestamp
    }
  }

  result(): AgentSessionLogActivity {
    return {
      lastAssistantText: this.text,
      pendingToolName: this.toolName,
      atMs: this.atMs,
      textBeyondScan: this.text === null && this.budgetExhausted
    }
  }
}
