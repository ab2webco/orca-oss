import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import { ticketInText } from '../../../shared/orchestrator-game-ticket-id'
import type { OrchestrationDb } from './db'
import { activityAt, type DispatchActivityProbe } from './dispatch-activity-observation'
import type { DispatchDeadlineNotifier } from './dispatch-deadline-monitor'
import type { DispatchContextRow } from './types'

export type SilentFailureOutcome = { dispatchId: string; action: 'reattached' | 'orphaned' }

// Why: past this long with nothing shown, the terminal is no evidence either way.
export const SILENT_FAILURE_WATCH_MS = AGENT_STATUS_STALE_AFTER_MS

type TaskText = { spec: string; task_title: string | null; display_name: string | null }

const ticketOf = (task: TaskText | undefined): string | null =>
  task
    ? (ticketInText(task.display_name) ?? ticketInText(task.task_title) ?? ticketInText(task.spec))
    : null

// Why: reopening beside a relaunch would give one ticket two live members (ORCA-754).
function blockerOf(db: OrchestrationDb, dispatch: DispatchContextRow, ticket: string | null) {
  if (db.hasNewerDispatchForTask(dispatch.id)) {
    return `task ${dispatch.task_id} was dispatched again`
  }
  const other = ticket
    ? db.listOtherLiveDispatchTasks(dispatch.id).find((row) => ticketOf(row) === ticket)
    : undefined
  return other ? `${ticket} already has a live member (dispatch ${other.id})` : null
}

function notify(
  db: OrchestrationDb,
  notifier: DispatchDeadlineNotifier,
  dispatch: DispatchContextRow,
  notice: { reason: string; subject: string; body: string; priority: 'normal' | 'high' }
): void {
  const message = db.insertMessage({
    from: `dispatch:${dispatch.id}`,
    to: `run:${dispatch.run_id}`,
    subject: notice.subject,
    body: notice.body,
    type: 'status',
    priority: notice.priority,
    payload: JSON.stringify({
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      reason: notice.reason
    }),
    runId: dispatch.run_id
  })
  notifier.notifyMessageArrived(message.to_handle, message.type)
}

/**
 * A dispatch the first-signal deadline failed by inference whose terminal kept working (ORCA-658):
 * reopen it when nothing replaced it, otherwise tell the lead once that it is orphaned.
 * The deadline itself is untouched (ORCA-191); host activity only acts after it fired.
 */
export function reattachSilentFailures(
  db: OrchestrationDb,
  probe: DispatchActivityProbe,
  notifier: DispatchDeadlineNotifier,
  now: Date = new Date()
): SilentFailureOutcome[] {
  const outcomes: SilentFailureOutcome[] = []
  const since = new Date(now.getTime() - SILENT_FAILURE_WATCH_MS).toISOString()
  for (const failed of db.listWatchedSilenceFailures(since)) {
    const at = activityAt(probe(failed.assignee_handle as string), now.getTime())
    if (at !== null) {
      db.recordSilenceFailureActivity(failed.id, new Date(at).toISOString())
    }
    if (!db.isActiveSinceSilenceFailure(failed.id)) {
      continue
    }
    const dispatch = db.getDispatchContextById(failed.id) as DispatchContextRow
    const ticket = ticketOf(db.getTask(dispatch.task_id))
    const label = ticket ?? `Task ${dispatch.task_id}`
    const facts = `Dispatch ${dispatch.id} was failed for silence at ${dispatch.completed_at} UTC, but its terminal ${dispatch.assignee_handle} kept working (last activity ${dispatch.last_activity_at}).`
    const blocker = blockerOf(db, dispatch, ticket)
    if (blocker === null) {
      const reopened = db.reopenDispatchFailedByInference({
        dispatchId: dispatch.id,
        reason: `Reopened by host-observed activity at ${dispatch.last_activity_at}: the worker kept working after the first-signal deadline.`,
        disarmDeadline: true
      })
      if (!reopened) {
        continue
      }
      notify(db, notifier, dispatch, {
        reason: 'reattached_by_activity',
        subject: `${label}: member reattached, it kept working after the deadline`,
        body: `${facts} It was reopened; its worker_done settles the task as usual.`,
        priority: 'normal'
      })
      outcomes.push({ dispatchId: dispatch.id, action: 'reattached' })
      continue
    }
    if (db.hasDispatchNotice(dispatch.id, 'orphaned_still_working')) {
      continue
    }
    notify(db, notifier, dispatch, {
      reason: 'orphaned_still_working',
      subject: `${label}: orphaned member still working`,
      body: `${facts} It stays failed because ${blocker}. Adopt its work or stop that terminal.`,
      priority: 'high'
    })
    outcomes.push({ dispatchId: dispatch.id, action: 'orphaned' })
  }
  return outcomes
}
