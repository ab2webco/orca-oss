// ─── Agent state read from the session log, not from the terminal buffer ────
// Every value here is a fact the append-only transcript states outright. The
// log cannot observe process liveness, so no state here means "dead" (ORCA-236).

import type { NativeChatTurnLifecycle } from './native-chat-types'

export const AGENT_SESSION_LOG_STATES = [
  /** A turn started and no completion or abort followed it. */
  'working',
  /** The last turn ended and nothing has been asked since. */
  'awaiting-input',
  /** Ended, with input already queued for the next turn. */
  'queued-input',
  /** The log is readable but carries no turn boundary at all. */
  'no-activity'
] as const
export type AgentSessionLogState = (typeof AGENT_SESSION_LOG_STATES)[number]

/** Why a value and not a silent fallback: an agent whose log has no queue events
 *  must say so, or "nothing queued" and "cannot tell" read identically. */
export type AgentSessionLogQueuedInput =
  | { supported: true; pending: number }
  | { supported: false; reason: string }

export const AGENT_SESSION_LOG_UNREAD_REASONS = [
  /** The agent writes no session log Orca can read. */
  'agent-unsupported',
  /** Orca does not know which session this pane is running (no hook identity yet). */
  'agent-session-unknown',
  'session-log-missing',
  'session-log-unreadable',
  /** The scan spent its ceiling without reaching a turn boundary. "I could not
   *  see the boundary" must never read as "there is no boundary". */
  'turn-boundary-beyond-scan'
] as const
export type AgentSessionLogUnreadReason = (typeof AGENT_SESSION_LOG_UNREAD_REASONS)[number]

export type AgentSessionLogReading =
  | {
      read: true
      state: AgentSessionLogState
      /** Epoch ms of the newest turn boundary, null when the log has none. */
      lastTurnAtMs: number | null
      queuedInput: AgentSessionLogQueuedInput
      /** Records the tail scan could not parse. Non-zero is degradation, not failure. */
      unparsedRecords: number
    }
  | { read: false; reason: AgentSessionLogUnreadReason }

export type AgentSessionLogFoldInput = {
  /** Newest turn boundary in the scanned window, if the log had one. */
  lifecycle: NativeChatTurnLifecycle | null
  queuedInput: AgentSessionLogQueuedInput
  unparsedRecords: number
  /** The scan stopped on its own ceiling rather than on the start of the log. */
  scanReachedCeiling: boolean
}

export function foldAgentSessionLogState(input: AgentSessionLogFoldInput): AgentSessionLogReading {
  const { lifecycle, queuedInput, unparsedRecords } = input
  const base = { read: true as const, queuedInput, unparsedRecords }
  if (!lifecycle) {
    return input.scanReachedCeiling
      ? { read: false, reason: 'turn-boundary-beyond-scan' }
      : { ...base, state: 'no-activity', lastTurnAtMs: null }
  }
  if (lifecycle.state === 'working') {
    return { ...base, state: 'working', lastTurnAtMs: lifecycle.timestamp }
  }
  const queued = queuedInput.supported && queuedInput.pending > 0
  return {
    ...base,
    state: queued ? 'queued-input' : 'awaiting-input',
    lastTurnAtMs: lifecycle.timestamp
  }
}
