import type { OrchestrationDb } from './orchestration/db'
import type { GameLeadNote } from './orchestrator-game-board'

/** Mail from the person to the lead's terminal; escalation is a type the lead's watch already passes. */
export function tellGameLead(
  db: Pick<OrchestrationDb, 'insertMessage'>,
  notify: (handle: string, type: string) => void,
  leadHandle: string,
  note: GameLeadNote
): boolean {
  try {
    const message = db.insertMessage({
      from: 'owner',
      to: leadHandle,
      subject: note.subject,
      body: note.body,
      type: 'escalation',
      priority: 'high',
      payload: JSON.stringify(note.payload)
    })
    notify(message.to_handle, message.type)
    return true
  } catch {
    return false
  }
}
