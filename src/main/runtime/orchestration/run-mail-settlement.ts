import type Database from '../../sqlite/sync-database'
import type { HostedReviewState } from '../../../shared/hosted-review'
import type { RetiredRunMailNotice } from '../../../shared/orchestration-check-output'

export type RetiredRunMail = { id: string; type: string; dispatchId: string | null }

/** A retired report's ticket and PR; null when its member worktree is gone. */
export type RetiredReportReview = {
  ticket: string
  pr: { number: number; state: HostedReviewState } | null
}

// Why the sender fallback: a member's own `send` names no dispatch, so its latest one in the Run stands in.
const MESSAGE_DISPATCH_ID_SQL = `COALESCE(
  CASE WHEN json_valid(m.payload) THEN json_extract(m.payload, '$.dispatchId') END,
  CASE WHEN m.from_handle LIKE 'dispatch:%' THEN substr(m.from_handle, 10) END,
  (SELECT s.id FROM dispatch_contexts s
    WHERE s.run_id = m.run_id AND s.assignee_handle = m.from_handle
    ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1)
)`

/**
 * Moves settled Run mail to history (read) so a lead's live queue and pointer only carry what it
 * can still act on: an answered or closed question, or a finished member's report from before the
 * current lead claimed the Run. Batches already handed to the current lead keep their ack contract.
 */
export function retireSettledRunMail(db: Database.Database, runId: string): RetiredRunMail[] {
  // Why runs.updated_at: only a consumer change (bind/unbind) rewrites it, so it marks when the current lead claimed the Run.
  const settled = db
    .prepare(
      `SELECT m.id AS id, m.type AS type, d.id AS dispatchId FROM messages m
         JOIN runs r ON r.id = m.run_id
         LEFT JOIN question_threads q ON q.message_id = m.id
         LEFT JOIN dispatch_contexts d ON d.id = ${MESSAGE_DISPATCH_ID_SQL}
        WHERE m.run_id = ? AND m.to_handle = 'run:' || m.run_id AND m.read = 0
          AND m.delivery_contract = 'current_delivery'
          AND (
            (m.type = 'question'
              AND (q.status IN ('answered', 'closed') OR d.status NOT IN ('pending', 'dispatched')))
            OR (m.type IN ('worker_done', 'escalation', 'status')
              AND d.status NOT IN ('pending', 'dispatched')
              AND m.created_at < r.updated_at)
          )
          AND m.id NOT IN (
            SELECT j.value FROM deliveries o, json_each(o.message_ids) j
             WHERE o.run_id = m.run_id AND o.status = 'outstanding'
          )
        ORDER BY m.sequence`
    )
    .all(runId) as RetiredRunMail[]
  if (settled.length > 0) {
    const placeholders = settled.map(() => '?').join(',')
    db.prepare(
      `UPDATE messages SET read = 1, delivered_at = COALESCE(delivered_at, datetime('now'))
       WHERE id IN (${placeholders})`
    ).run(...settled.map((message) => message.id))
  }
  return settled
}

/** One line's worth for the lead: how much moved to history and which reports still need a look. */
export async function summarizeRetiredRunMail(
  retired: readonly RetiredRunMail[],
  reviewOf: (dispatchId: string) => Promise<RetiredReportReview | null>
): Promise<RetiredRunMailNotice> {
  const dispatchIds = [
    ...new Set(
      retired.flatMap((message) =>
        message.type === 'worker_done' && message.dispatchId ? [message.dispatchId] : []
      )
    )
  ]
  const reviews = await Promise.all(dispatchIds.map((dispatchId) => reviewOf(dispatchId)))
  const unverified = reviews.flatMap((review) =>
    review && review.pr?.state !== 'merged' && review.pr?.state !== 'closed'
      ? [
          {
            ticket: review.ticket,
            pr: review.pr ? `#${review.pr.number} ${review.pr.state}` : null
          }
        ]
      : []
  )
  return { count: retired.length, unverified }
}
