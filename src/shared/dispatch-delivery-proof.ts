/**
 * One phrasing for "the preamble was written but its delivery was never
 * proven", shared by every human-readable dispatch line (ORCA-208).
 *
 * Why it belongs on the default line and not only in `--json`: this whole
 * incident is reported state disagreeing with real state. A worker sitting at a
 * prompt with the task echoed above it reads as `[ready]` to the coordinator,
 * and a fact that only exists in the structured payload leaves the default path
 * saying exactly what it said before. Same reason ORCA-186 put `liveness` on the
 * line and ORCA-175 put the `terminal` block there.
 *
 * Why the wording is this long: "unproven" alone is ambiguous with a failed
 * write. The bytes did leave Orca — what is missing is evidence the agent's
 * composer took them — and a coordinator deciding whether to re-dispatch needs
 * those to be distinguishable.
 */
export const DISPATCH_DELIVERY_UNPROVEN_NOTE =
  'preamble written, delivery unproven: the agent never emitted its composer-ready marker'

/** The `dispatch_input` effect state a write with no readiness proof records. */
export const DISPATCH_INPUT_WRITTEN_UNPROVEN = 'written_unproven'

type DeliveryProofInput = {
  /** `dispatch_contexts.composer_ready_proven`: 1 proven, 0 unproven, null unknown. */
  composerReadyProven?: number | boolean | null
  /** The `dispatch_input` effect state, for callers holding effects instead. */
  dispatchInputState?: string | null
}

/**
 * True only for a dispatch positively recorded as unproven.
 *
 * `null`/`undefined` is deliberately not unproven: the column is null for rows
 * written before it existed, for federated dispatches reconciled elsewhere, and
 * for tracking dispatches that never injected a preamble at all. Printing the
 * note there would be a false alarm on dispatches that were never in question.
 */
export function isDispatchDeliveryUnproven(input: DeliveryProofInput): boolean {
  if (input.dispatchInputState === DISPATCH_INPUT_WRITTEN_UNPROVEN) {
    return true
  }
  return input.composerReadyProven === 0 || input.composerReadyProven === false
}

/** The note as a line suffix, or '' when delivery was proven or is unknown. */
export function formatDispatchDeliveryNote(input: DeliveryProofInput): string {
  return isDispatchDeliveryUnproven(input) ? ` — ${DISPATCH_DELIVERY_UNPROVEN_NOTE}` : ''
}
