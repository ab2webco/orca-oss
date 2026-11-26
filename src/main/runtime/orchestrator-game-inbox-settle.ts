import type { OrchestrationDb } from './orchestration/db'
import type { GameBoardCaller, GameBoardLead, GameBoardProject } from './orchestrator-game-board'
import {
  leadWaitingRowsOf,
  stuckReasonOf,
  type GameInboxMail,
  type GameInboxSource,
  type GameStuckReason
} from '../../shared/orchestrator-game-inbox'
import type { GameOwnerAnswerVia } from '../../shared/orchestrator-game-owner-questions'

export type GameInboxSettle = { note: string; via: GameOwnerAnswerVia }

export type GameInboxSettled = {
  settled: { id: string; subject: string; stuck: GameStuckReason | null }
  noteId: string
}

/** Settles what waits on the lead with a note, for mail no reply can settle (ORCA-1482); lead and person only. */
export class GameInboxSettler {
  constructor(
    private readonly deps: {
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      inboxSourceOf: (lead: GameBoardLead) => GameInboxSource
      /** Writes the note that settles the row; returns its id. */
      write: (lead: GameBoardLead, row: GameInboxMail, settle: GameInboxSettle) => string
    }
  ) {}

  async settle(
    args: GameBoardCaller & GameInboxSettle & { id: string }
  ): Promise<GameInboxSettled> {
    const project = await this.deps.projectOf(args)
    if (project.isMember) {
      throw new Error('Only the lead settles what waits on it; a member answers its lead.')
    }
    if (!project.lead) {
      throw new Error('This project has no live lead whose inbox holds this message.')
    }
    const source = this.deps.inboxSourceOf(project.lead)
    const row = leadWaitingRowsOf(source).find((one) => one.id === args.id)
    if (!row) {
      throw new Error(`${args.id} is not waiting on the lead, so there is nothing to settle.`)
    }
    // Why: its member is blocked in `orchestration ask` until it gets an answer, which a note is not.
    if (row.type === 'question') {
      throw new Error(
        `${args.id} is a question its member waits on: answer it with orca orchestration reply --id ${args.id}`
      )
    }
    const noteId = this.deps.write(project.lead, row, { note: args.note, via: args.via })
    return {
      settled: { id: row.id, subject: row.subject, stuck: stuckReasonOf(source)(row) },
      noteId
    }
  }
}

/**
 * Settles a row that waits on the lead without a reply, with the lead's note kept beside it as the
 * audit (ORCA-1482). The note names the row in reply_to, the field a reply settles by (ORCA-1481),
 * so every reader that settles on a reply settles on it too. Returns the note's id.
 */
export function settleLeadInboxRow(
  db: Pick<OrchestrationDb, 'insertReplyAndMarkRead' | 'markAsReadAndDelivered'>,
  lead: GameBoardLead,
  row: GameInboxMail,
  settle: GameInboxSettle
): string {
  const note = db.insertReplyAndMarkRead(row.id, {
    from: lead.handle,
    // Why the row's own address: it is one of the lead's, so the inbox reads the note with the row.
    to: row.to_handle,
    subject: `Settled: ${row.subject}`,
    body: `Settled ${row.id} without a reply (${settle.via}): ${settle.note}`,
    type: 'status',
    threadId: row.thread_id ?? row.id,
    payload: JSON.stringify({ settled: row.id, via: settle.via }),
    // Why named: a legacy row's note stays in the legacy Run, which an adopted host requires.
    ...(row.run_id ? { runId: row.run_id } : {}),
    // Why audit only: it is a record, never mail to deliver, so no check hands it to the lead.
    deliveryContract: 'audit_only',
    replyTo: row.id
  })
  db.markAsReadAndDelivered([note.id])
  return note.id
}
