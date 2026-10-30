import type { MessageType } from './types'

// Why: these only report progress; the replay contract protects mail a consumer must act on.
const INFORMATIONAL_TYPES: ReadonlySet<string> = new Set<MessageType>(['status', 'heartbeat'])

/** A typed wait may retire an unacknowledged batch that holds nothing it asked for and nothing actionable (ORCA-701). */
export function isBatchRetirableForWait(
  batch: readonly { type: string }[],
  wakeTypes: readonly string[]
): boolean {
  return batch.every(
    (message) => INFORMATIONAL_TYPES.has(message.type) && !wakeTypes.includes(message.type)
  )
}

/**
 * SQL over `messages` true for mail a typed Run watch wakes on whatever its types: anything the
 * Run's own members or the runtime did not send, such as another lead or the owner (ORCA-861).
 */
export function outsideMemberMailSql(runId: string): { sql: string; params: string[] } {
  return {
    sql: `(type <> 'heartbeat'
      AND from_handle NOT LIKE 'dispatch:%' AND from_handle NOT LIKE 'task:%'
      AND from_handle <> ?
      AND from_handle NOT IN (SELECT coordinator_handle FROM runs WHERE id = ? AND coordinator_handle IS NOT NULL)
      AND from_handle NOT IN (
        SELECT assignee_handle FROM dispatch_contexts
        WHERE run_id = ? AND assignee_handle IS NOT NULL)
      AND (sender_pane_key IS NULL OR sender_pane_key NOT IN (
        SELECT assignee_pane_key FROM dispatch_contexts
        WHERE run_id = ? AND assignee_pane_key IS NOT NULL)))`,
    params: [`run:${runId}`, runId, runId, runId]
  }
}
