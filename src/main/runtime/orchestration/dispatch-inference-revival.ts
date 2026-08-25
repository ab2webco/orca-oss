import type { OrchestrationDb } from './db'
import type { DispatchContextRow, MessageRow } from './types'
import {
  hasLifecycleAuthority,
  buildLifecycleAuthorityRejectionReason
} from './lifecycle-authority'
import type { LifecycleLogFn } from './lifecycle-rejection'
import type { LifecycleReconciliationResult } from './lifecycle-reconciliation'

/**
 * A lifecycle message on a non-`dispatched` Dispatch: revive it, or explain why
 * not (ORCA-299).
 *
 * One definition for both callers on purpose. A `worker_done` that reopens while
 * a heartbeat does not — or the reverse — is worse than neither, because the
 * worker would get a channel for exactly one of the two things it needs to say.
 *
 * The order is the whole safety argument: reopen is considered only for a
 * Dispatch failed by *inferring* death from silence, and only after
 * `hasLifecycleAuthority` proves the sender is the assignee. A wrong-pane
 * heartbeat must not resurrect a Dispatch any more than it may refresh one —
 * that would mask a hung assignee behind another agent's timer, which the
 * ticket calls out as worse than the bug being fixed.
 */
export type InferenceRevival =
  // Why no result on `revived`: each caller resumes its own normal path — the
  // heartbeat records the beat, worker_done goes on to settle — so a shared
  // result here would only be a value both of them discard.
  | { action: 'revived' }
  | { action: 'rejected'; result: LifecycleReconciliationResult }
  | { action: 'not_revivable'; explanation: string }

export function reviveInferenceFailedDispatch(
  db: OrchestrationDb,
  msg: MessageRow,
  dispatchId: string,
  dispatch: DispatchContextRow | undefined,
  onLog: LifecycleLogFn,
  label: string
): InferenceRevival {
  if (!dispatch) {
    return { action: 'not_revivable', explanation: `dispatch ${dispatchId} is unknown` }
  }
  if (!db.isDispatchFailedByInference(dispatchId)) {
    // Why (requirement 3): the coordinator used to get a bare "suppressed" and
    // had to go read the Dispatch to learn whether anything could be done. The
    // provenance is the actionable half — a Dispatch that failed on evidence is
    // not coming back, and one that merely completed never needed to.
    return {
      action: 'not_revivable',
      explanation:
        dispatch.status === 'failed' || dispatch.status === 'circuit_broken'
          ? `dispatch is ${dispatch.status} on reported evidence (${dispatch.last_failure ?? 'no reason recorded'}), not on inferred silence, so it cannot be reopened`
          : `dispatch is ${dispatch.status}, which is a settled outcome, not a false deadline`
    }
  }
  if (!hasLifecycleAuthority(dispatch, msg)) {
    // Why: authority is checked before the reopen takes effect, not after — a
    // reopen is a stronger act than a liveness refresh, so it cannot have a
    // weaker sender check.
    const reason = buildLifecycleAuthorityRejectionReason(dispatchId, dispatch, msg)
    onLog(`${label} rejected: ${reason}`)
    db.convertLifecycleMessageToRejection(msg.id, 'sender_not_assignee', reason)
    return {
      action: 'rejected',
      result: { action: 'rejected', code: 'sender_not_assignee', reason }
    }
  }
  const reopened = db.reopenDispatchFailedByInference({
    dispatchId,
    reason: `Reopened by ${msg.type} from ${msg.from_handle}: the worker refuted the first-signal deadline.`
  })
  if (!reopened) {
    return { action: 'not_revivable', explanation: `dispatch ${dispatchId} could not be reopened` }
  }
  onLog(
    `${label} reopened dispatch ${dispatchId}: it was failed for silence, and the assignee is alive.`
  )
  return { action: 'revived' }
}
