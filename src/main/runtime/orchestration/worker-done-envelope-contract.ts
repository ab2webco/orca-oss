import type { OrchestrationDb } from './db'
import type { DispatchContextRow, MessageRow, WorkerReportOutcome } from './types'
import {
  rejectLifecycleMessage,
  type LifecycleLogFn,
  type LifecycleRejectionResult
} from './lifecycle-rejection'
import {
  buildEnvelopeCorrectionReason,
  buildEnvelopeExhaustedReason,
  envelopeStatusOutcome,
  MAX_ENVELOPE_CORRECTION_ATTEMPTS,
  parseWorkerDoneEnvelope,
  type WorkerDoneEnvelope
} from './worker-done-envelope'

export type EnvelopeContractResult =
  | { action: 'accepted'; envelope: WorkerDoneEnvelope | null }
  | LifecycleRejectionResult

export function envelopeOutcomeMismatch(
  envelope: WorkerDoneEnvelope,
  outcome: WorkerReportOutcome
): string[] {
  const expected = envelopeStatusOutcome(envelope.status)
  if (expected === outcome) {
    return []
  }
  return [
    `status: "${envelope.status}" contradicts outcome "${outcome}"; send outcome "${expected}" or change the envelope status`
  ]
}

/**
 * Validates the typed envelope a worker_done must carry, and counts one
 * correction attempt per rejected report so the in-session loop stays bounded.
 */
export function enforceEnvelopeContract(
  db: OrchestrationDb,
  msg: MessageRow,
  dispatch: DispatchContextRow,
  outcome: WorkerReportOutcome,
  rawEnvelope: unknown,
  onLog: LifecycleLogFn
): EnvelopeContractResult {
  if (dispatch.envelope_contract !== 1 || db.getFederatedDispatch(dispatch.id)) {
    // Why: a dispatch briefed before the typed envelope existed never learned
    // the contract, so holding it to one would strand an in-flight worker.
    // A federated worker settles its own attachment when it relays the report,
    // so a home-side rejection could never be corrected — see ORCA-178 follow-up.
    return { action: 'accepted', envelope: null }
  }
  const parsed = parseWorkerDoneEnvelope(rawEnvelope)
  const errors = parsed.ok ? envelopeOutcomeMismatch(parsed.envelope, outcome) : parsed.errors
  if (parsed.ok && errors.length === 0) {
    return { action: 'accepted', envelope: parsed.envelope }
  }
  const attempt = db.recordEnvelopeCorrectionAttempt(dispatch.id)
  if (attempt > MAX_ENVELOPE_CORRECTION_ATTEMPTS) {
    return rejectLifecycleMessage(
      db,
      msg,
      'envelope_correction_exhausted',
      buildEnvelopeExhaustedReason(errors),
      onLog
    )
  }
  return rejectLifecycleMessage(
    db,
    msg,
    'invalid_envelope',
    buildEnvelopeCorrectionReason(errors, attempt),
    onLog
  )
}
