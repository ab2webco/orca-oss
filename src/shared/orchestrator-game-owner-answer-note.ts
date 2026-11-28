import {
  clipped,
  gameOwnerQuestionTickets,
  type GameOwnerQuestion
} from './orchestrator-game-owner-questions'

/** What the lead is told to do with an answer: Orca already keeps it, so the tracker gets product words only (ORCA-1488). */
export function gameAnswerRecordLine(ticket: string | null, recordOnTicket: boolean): string {
  if (!recordOnTicket) {
    return 'Orca already keeps this answer (orca game owner-questions, orca game history): do not comment it on the tracker.'
  }
  const where = ticket ? ` on ${ticket}` : ''
  return `Record this answer${where}: the question and the answer in product terms, never Orca's ids, hosts or authorizations.`
}

// Why the answer first: it is what the lead acts on, so it leads the body.
export function gameOwnerAnswerNote(
  question: GameOwnerQuestion,
  recordOnTicket = true
): {
  subject: string
  body: string
  payload: Record<string, unknown>
} {
  const answer = question.answer?.text ?? ''
  const tickets = gameOwnerQuestionTickets(question)
  const named = tickets.length > 0 ? tickets.join(', ') : null
  return {
    subject: `Owner answered${named ? ` ${named}` : ''}: ${clipped(question.question, 80)}`,
    body: [
      `Answer: ${answer}`,
      `Question: ${question.question}`,
      gameAnswerRecordLine(named, recordOnTicket),
      `When you relay it to a member, cite ${question.id} in that mail, never on the tracker: the member checks it with \`orca game owner-question ${question.id}\`.`
    ].join('\n'),
    payload: {
      ownerQuestionId: question.id,
      ticket: question.ticket,
      ...(question.tickets ? { tickets: question.tickets } : {}),
      answer
    }
  }
}
