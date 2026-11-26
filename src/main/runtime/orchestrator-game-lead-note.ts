import type { OrchestrationDb } from './orchestration/db'
import type { GameBoardLead, GameLeadNote } from './orchestrator-game-board'
import { GAME_OWNER_HANDLE } from '../../shared/orchestrator-game-inbox'

/** Mail from the person to the lead's terminal; escalation is a type the lead's watch already passes. */
export function tellGameLead(
  db: Pick<
    OrchestrationDb,
    'insertMessage' | 'getCurrentRunForPane' | 'getRunCoordinatedBy' | 'createRun'
  >,
  notify: (handle: string, type: string) => void,
  lead: GameBoardLead,
  note: GameLeadNote
): boolean {
  try {
    // Why the lead's Run (ORCA-942): an adopted host refuses mail without one, and the watch reads its Run.
    const paneRun =
      (lead.paneKey ? db.getCurrentRunForPane(lead.paneKey) : undefined) ??
      // Why (ORCA-1100): a lead rotated with --fresh has no Run until it dispatches, and its unbound
      // watch refuses legacy-Run mail, so the answer opens the Run the lead's next check reads.
      (lead.paneKey && !db.getRunCoordinatedBy(lead.handle)
        ? db.createRun({
            objective: 'Owner answers for the lead',
            coordinatorHandle: lead.handle,
            coordinatorPaneKey: lead.paneKey
          })
        : undefined)
    const run = paneRun ?? db.getRunCoordinatedBy(lead.handle)
    const message = db.insertMessage({
      from: GAME_OWNER_HANDLE,
      // Why the Run's mailbox when the pane holds it (ORCA-1482): its consumer can reply after the
      // lead's handle is reminted, and the game inbox reads that mailbox for this pane.
      to: paneRun ? `run:${paneRun.id}` : lead.handle,
      subject: note.subject,
      body: note.body,
      type: 'escalation',
      priority: 'high',
      payload: JSON.stringify(note.payload),
      ...(run ? { runId: run.id } : {})
    })
    notify(message.to_handle, message.type)
    return true
  } catch {
    return false
  }
}
