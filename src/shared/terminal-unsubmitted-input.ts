// ─── Input Orca wrote into a pane that the agent never took ─────────────────
// Read from what this runtime wrote and what the PTY printed back, never from
// the session log: unsent composer text is precisely the input that never
// reached the transcript, so `AgentSessionLogState` cannot carry it (ORCA-457).

/** What makes a pane's input look stuck. */
export const TERMINAL_UNSUBMITTED_INPUT_EVIDENCES = [
  /** Text was written and no submit followed it — it is sitting in the composer. */
  'text-without-submit',
  /** A submit was written and the agent never reacted the way a new turn looks. */
  'submit-without-turn'
] as const
export type TerminalUnsubmittedInputEvidence = (typeof TERMINAL_UNSUBMITTED_INPUT_EVIDENCES)[number]

export const TERMINAL_UNSUBMITTED_INPUT_UNOBSERVED_REASONS = [
  /** This runtime never watched the PTY from spawn — an adopted session, or a
   *  gapped byte stream. No write history exists to draw a conclusion from. */
  'pty-not-watched',
  /** The handle resolves to no live PTY at all. */
  'pty-gone'
] as const
export type TerminalUnsubmittedInputUnobservedReason =
  (typeof TERMINAL_UNSUBMITTED_INPUT_UNOBSERVED_REASONS)[number]

export type TerminalUnsubmittedInputPending = {
  evidence: TerminalUnsubmittedInputEvidence
  /** Epoch ms of the write that is still outstanding. */
  sinceMs: number
}

/**
 * Why a discriminated union and not `pending: … | null`: "nothing outstanding"
 * and "I cannot tell" must not read alike — the same reason
 * `AgentSessionLogQueuedInput` carries `supported`. A coordinator that treats an
 * unwatched pane as healthy is the failure this whole field exists to prevent.
 */
export type TerminalUnsubmittedInput =
  | { observed: true; pending: TerminalUnsubmittedInputPending | null }
  | { observed: false; reason: TerminalUnsubmittedInputUnobservedReason }

/** True when the pane is holding input the agent has not taken. */
export function hasUnsubmittedInput(input: TerminalUnsubmittedInput | undefined): boolean {
  return input?.observed === true && input.pending !== null
}
