import type { OrchestrationDb } from './orchestration/db'
import type { GameBoardLead, GameLeadNote } from './orchestrator-game-board'

/** Mail from the person to the lead's terminal; escalation is a type the lead's watch already passes. */
export function tellGameLead(
  db: Pick<OrchestrationDb, 'insertMessage' | 'getCurrentRunForPane' | 'getRunCoordinatedBy'>,
  notify: (handle: string, type: string) => void,
  lead: GameBoardLead,
  note: GameLeadNote
): boolean {
  try {
    // Why the lead's Run (ORCA-942): an adopted host refuses mail without one, and the watch reads its Run.
    const run =
      (lead.paneKey ? db.getCurrentRunForPane(lead.paneKey) : undefined) ??
      db.getRunCoordinatedBy(lead.handle)
    const message = db.insertMessage({
      from: 'owner',
      to: lead.handle,
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
