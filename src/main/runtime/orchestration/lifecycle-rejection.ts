import type { OrchestrationDb } from './db'
import type { MessageRow } from './types'

export type LifecycleRejectionCode =
  | 'sender_not_assignee'
  | 'dispatch_capability_invalid'
  | 'invalid_payload'
  | 'missing_task_id'
  | 'missing_dispatch_id'
  | 'invalid_outcome'
  | 'invalid_envelope'
  | 'envelope_correction_exhausted'
  | 'unknown_task'
  | 'unknown_dispatch'
  | 'task_dispatch_mismatch'
  | 'inactive_dispatch'
  | 'stale_dispatch'

export type LifecycleRejectionResult = {
  action: 'rejected'
  code: LifecycleRejectionCode
  reason: string
}

export type LifecycleLogFn = (msg: string) => void

export const noopLifecycleLog: LifecycleLogFn = () => {}

export function rejectLifecycleMessage(
  db: OrchestrationDb,
  msg: MessageRow,
  code: LifecycleRejectionCode,
  reason: string,
  onLog: LifecycleLogFn
): LifecycleRejectionResult {
  onLog(`Warning: ${msg.type} rejected: ${reason}`)
  db.convertLifecycleMessageToRejection(msg.id, code, reason)
  return { action: 'rejected', code, reason }
}
