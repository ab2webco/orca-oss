import type { OrchestrationDb } from './db'
import type { LifecycleRejectionResult } from './lifecycle-rejection'
import type { MessageRow } from './types'

/** Why a heartbeat from the Dispatch's own pane cannot be from its live process, or null when it can. */
export function describeDeadHeartbeatSender(
  dispatchIncarnation: string | null,
  senderIncarnation: string | null | undefined
): string | null {
  if (!senderIncarnation) {
    return 'the sending terminal no longer exists at this host'
  }
  // Why: a pane remounted after a restart keeps its key but runs a new process; the key alone is not liveness.
  if (dispatchIncarnation && dispatchIncarnation !== senderIncarnation) {
    return 'the sending terminal runs a different process than the one the Dispatch was given to'
  }
  return null
}

export function logHeartbeatRejection(
  msg: Pick<MessageRow, 'from_handle' | 'sender_pane_key'>,
  dispatchId: string | undefined,
  reason: string
): void {
  console.warn('[orchestration] heartbeat rejected', {
    dispatchId,
    from: msg.from_handle,
    paneKey: msg.sender_pane_key,
    reason
  })
}

/** Rejects to the sender but archives the row, so a leftover loop never wakes the coordinator. */
export function rejectHeartbeatQuietly(
  db: OrchestrationDb,
  msg: MessageRow,
  dispatchId: string,
  rejection: LifecycleRejectionResult
): { message: MessageRow; lifecycle: LifecycleRejectionResult } {
  const message =
    db.convertLifecycleMessageToRejection(msg.id, rejection.code, rejection.reason) ?? msg
  db.markAsReadAndDelivered([msg.id])
  logHeartbeatRejection(msg, dispatchId, rejection.reason)
  return { message: db.getMessageById(msg.id) ?? message, lifecycle: rejection }
}
