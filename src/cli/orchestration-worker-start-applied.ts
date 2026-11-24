import { RuntimeClientError, RuntimeRpcFailureError, type RuntimeClient } from './runtime-client'
import {
  isUnknownMutationOutcomeCode,
  orchestrationMutationRecoveryError,
  stripUnsafeRetryAdvice
} from './orchestration-mutation-recovery'

/** Whether a worker-start whose answer was lost took effect (ORCA-1398). */
export type WorkerStartApplied =
  | { applied: 'applied'; dispatchId: string }
  | { applied: 'not_applied' | 'unknown' }

export type WorkerStartOutcomeProbe = (requestId: string) => Promise<WorkerStartApplied>

const PROBE_TIMEOUT_MS = 10_000

/** Asks the runtime for the request's receipt; an older runtime, or none at all, leaves it unknown. */
export function workerStartOutcomeProbe(client: RuntimeClient): WorkerStartOutcomeProbe {
  return async (requestId) => {
    try {
      const { result } = await client.call<Partial<{ applied: string; dispatchId: string }>>(
        'orchestration.workerStartOutcome',
        { requestId },
        { timeoutMs: PROBE_TIMEOUT_MS }
      )
      if (result.applied === 'applied' && typeof result.dispatchId === 'string') {
        return { applied: 'applied', dispatchId: result.dispatchId }
      }
      return { applied: result.applied === 'not_applied' ? 'not_applied' : 'unknown' }
    } catch {
      return { applied: 'unknown' }
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

/** The worker-start error, reworded to say whether the start applied; other errors pass through. */
export async function workerStartFailureOf(
  error: unknown,
  requestId: string,
  probe: WorkerStartOutcomeProbe
): Promise<unknown> {
  if (!(error instanceof RuntimeClientError) || !isUnknownMutationOutcomeCode(error.code)) {
    return error
  }
  const outcome: WorkerStartApplied = neverSent(error)
    ? { applied: 'not_applied' }
    : await probe(requestId)
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
        `${recovered.message}\nWhether the start applied is unknown: Orca Lab could not be asked.`,
        recovered.data
      )
    : recovered
}
