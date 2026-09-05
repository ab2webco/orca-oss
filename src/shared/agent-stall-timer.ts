/**
 * State machine behind the "check if it is stuck" agent timer.
 *
 * Progress is a *delta*, never a level: a dirty worktree does not mean an agent is working,
 * a worktree whose fingerprint changed since the previous tick does. A level-based signal
 * reads a fix that has been staged and abandoned for hours as healthy.
 */

export type AgentStallProbe =
  /** Fingerprint of the worktree's git state at this tick. */
  | { kind: 'fingerprint'; value: string }
  /** The probe could not be read (timeout, git failure). Never treated as "unchanged". */
  | { kind: 'unreadable' }

export type AgentStallTimerState = {
  /** Fingerprint of the last readable tick; null until the first one lands. */
  lastFingerprint: string | null
  /** Latch: escalation fires once per stall, not once per tick. */
  escalated: boolean
}

export type AgentStallTickOutcome =
  | 'progressing'
  | 'escalate'
  | 'stalled-already-escalated'
  | 'unreadable'

export type AgentStallTickResult = {
  state: AgentStallTimerState
  outcome: AgentStallTickOutcome
}

export const AGENT_STALL_TIMER_INTERVAL_MINUTES = [15, 30, 60] as const

export type AgentStallTimerIntervalMinutes = (typeof AGENT_STALL_TIMER_INTERVAL_MINUTES)[number]

export function isAgentStallTimerIntervalMinutes(
  value: number
): value is AgentStallTimerIntervalMinutes {
  return (AGENT_STALL_TIMER_INTERVAL_MINUTES as readonly number[]).includes(value)
}

export function advanceAgentStallTimer(
  state: AgentStallTimerState,
  probe: AgentStallProbe
): AgentStallTickResult {
  // An unread probe carries the previous fingerprint forward. Counting a slow git call as
  // "unchanged" would escalate a healthy worker whose host was merely under load.
  if (probe.kind === 'unreadable') {
    return { state, outcome: 'unreadable' }
  }

  if (probe.value !== state.lastFingerprint) {
    return {
      state: { lastFingerprint: probe.value, escalated: false },
      outcome: 'progressing'
    }
  }

  if (state.escalated) {
    return { state, outcome: 'stalled-already-escalated' }
  }

  return {
    state: { lastFingerprint: probe.value, escalated: true },
    outcome: 'escalate'
  }
}
