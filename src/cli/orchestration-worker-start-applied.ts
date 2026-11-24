import { RuntimeClientError, RuntimeRpcFailureError, type RuntimeClient } from './runtime-client'
import {
  isUnknownMutationOutcomeCode,
  orchestrationMutationRecoveryError,
  stripUnsafeRetryAdvice
} from './orchestration-mutation-recovery'

/** Whether a worker-start whose answer was lost took effect (ORCA-1398). */
export type WorkerStartApplied =
  | { applied: 'applied'; dispatchId: string }
  | { applied: 'not_applied' }
  | { applied: 'unknown'; reason: WorkerStartUnknownReason }

/** Why the outcome is unknown: the runtime's own answer, or that it gave none. */
export type WorkerStartUnknownReason = 'in_flight' | 'no_dispatch' | 'undecided' | 'unanswered'

const ANSWERED_UNKNOWN: ReadonlySet<unknown> = new Set(['in_flight', 'no_dispatch'])

export type WorkerStartOutcomeProbe = (requestId: string) => Promise<WorkerStartApplied>

const PROBE_TIMEOUT_MS = 10_000

/** Asks the runtime for the request's receipt; an older runtime, or none at all, leaves it unknown. */
export function workerStartOutcomeProbe(client: RuntimeClient): WorkerStartOutcomeProbe {
  return async (requestId) => {
    try {
      const { result } = await client.call<
        Partial<{ applied: string; dispatchId: string; reason: string }>
      >('orchestration.workerStartOutcome', { requestId }, { timeoutMs: PROBE_TIMEOUT_MS })
      if (result.applied === 'applied' && typeof result.dispatchId === 'string') {
        return { applied: 'applied', dispatchId: result.dispatchId }
      }
      if (result.applied === 'not_applied') {
        return { applied: 'not_applied' }
      }
      const reason = ANSWERED_UNKNOWN.has(result.reason)
        ? (result.reason as WorkerStartUnknownReason)
        : 'undecided'
      return { applied: 'unknown', reason }
    } catch {
      return { applied: 'unknown', reason: 'unanswered' }
    }
  }
}

const dataOf = (error: RuntimeClientError): Record<string, unknown> =>
  error.data !== null && typeof error.data === 'object'
    ? (error.data as Record<string, unknown>)
    : {}

// Why the id check: the client tags every failed send with its request id, so an untagged
// transport error was raised before the request left this shell.
function neverSent(error: RuntimeClientError): boolean {
  const data = dataOf(error)
  return (
    data.requestSent === false ||
    (!(error instanceof RuntimeRpcFailureError) && typeof data.orchestrationRequestId !== 'string')
  )
}

const unknownLineOf = (reason: WorkerStartUnknownReason, requestId: string): string =>
  ({
    in_flight: `Orca Lab is still handling request ${requestId}.`,
    no_dispatch: `Orca Lab recorded request ${requestId} but no Dispatch for it, as a start queued for setup does.`,
    undecided: 'Orca Lab answered but could not tell.',
    unanswered: 'Orca Lab could not be asked.'
  })[reason]

/** The worker-start error, reworded to say whether the start applied; other errors pass through. */
export async function workerStartFailureOf(
  error: unknown,
  requestId: string,
  probe: WorkerStartOutcomeProbe,
  retriedRequest = false
): Promise<unknown> {
  if (!(error instanceof RuntimeClientError) || !isUnknownMutationOutcomeCode(error.code)) {
    return error
  }
  // Why not for a retried id: an earlier attempt under it may have applied (ORCA-1398).
  const outcome: WorkerStartApplied =
    !retriedRequest && neverSent(error) ? { applied: 'not_applied' } : await probe(requestId)
  const data = { ...dataOf(error), orchestrationRequestId: requestId, ...outcome }
  if (outcome.applied === 'applied') {
    const message = stripUnsafeRetryAdvice(error.message, requestId)
    return new RuntimeClientError(
      error.code,
      `${message}\nThe start applied: Orca Lab accepted it as Dispatch ${outcome.dispatchId}, so do not start another worker. Inspect it with orca orchestration worker-show --dispatch ${outcome.dispatchId}.`,
      data
    )
  }
  if (outcome.applied === 'not_applied') {
    return new RuntimeClientError(
      error.code,
      `${error.message}\nThe start did not apply: Orca Lab holds no record of request ${requestId}, so no worker started. Run the command again once Orca Lab answers.`,
      data
    )
  }
  const recovered = orchestrationMutationRecoveryError(
    new RuntimeClientError(error.code, error.message, data)
  )
  return recovered instanceof RuntimeClientError
    ? new RuntimeClientError(
        recovered.code,
        `${recovered.message}\nWhether the start applied is unknown: ${unknownLineOf(outcome.reason, requestId)}`,
        recovered.data
      )
    : recovered
}
