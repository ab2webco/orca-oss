import type { OrchestrationDb } from './db'
import {
  DISPATCH_FIRST_SIGNAL_DEADLINE_MS,
  buildDispatchDeadlineFailureReason,
  describeDispatchDeadlineSubject
} from './dispatch-lifecycle-deadline'

export type DispatchDeadlineExpiry = {
  dispatchId: string
  taskId: string
  runId: string
  reason: string
}

export type DispatchDeadlineNotifier = {
  notifyMessageArrived(handle: string, messageType?: string): void
}

/**
 * Fails every armed dispatch whose first-signal deadline passed with no
 * qualifying lifecycle signal, and wakes the Run's `check --wait` consumer.
 * Never reinjects and never touches the pane: the submit outcome is ambiguous
 * by construction, so retry stays explicit and human-initiated.
 */
export function expireDueDispatchDeadlines(
  db: OrchestrationDb,
  notifier: DispatchDeadlineNotifier,
  now: Date = new Date()
): DispatchDeadlineExpiry[] {
  const nowIso = now.toISOString()
  const expired: DispatchDeadlineExpiry[] = []
  for (const candidate of db.listExpiredDispatchDeadlines(nowIso)) {
    const reason = buildDispatchDeadlineFailureReason({
      dispatchId: candidate.id,
      taskId: candidate.task_id,
      placement: db.getDispatchDeadlinePlacement(candidate.id),
      deadlineMs: DISPATCH_FIRST_SIGNAL_DEADLINE_MS
    })
    const outcome = db.expireDispatchLifecycleDeadline({
      dispatchId: candidate.id,
      nowIso,
      reason,
      subject: describeDispatchDeadlineSubject(candidate.id)
    })
    if (!outcome.expired) {
      continue
    }
    notifier.notifyMessageArrived(outcome.message.to_handle, outcome.message.type)
    expired.push({
      dispatchId: candidate.id,
      taskId: candidate.task_id,
      runId: candidate.run_id,
      reason
    })
  }
  return expired
}
