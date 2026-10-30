import type { OrchestrationDb } from './orchestration/db'
import type { GameBoardLead, GameLeadNote } from './orchestrator-game-board'

export type OwnerMemberReplyDb = Pick<
  OrchestrationDb,
  'getCurrentRunForPane' | 'getMessageById' | 'getQuestion' | 'answerQuestion' | 'insertMessage'
>

/** `answered` a waiting question, `override` one the lead had answered, `reply` a gate or other mail. */
export type OwnerMemberReplyMode = 'answered' | 'override' | 'reply'

export type OwnerMemberReply = { mode: OwnerMemberReplyMode; question: string }

/** The person speaks to a member as the lead does: through the lead's run, so the member treats it as its lead's word. */
export function replyToMemberAsLead(
  db: OwnerMemberReplyDb,
  notify: (handle: string, type: string) => void,
  lead: GameBoardLead,
  args: { id: string; text: string }
): OwnerMemberReply {
  const run = lead.paneKey ? db.getCurrentRunForPane(lead.paneKey) : undefined
  const message = db.getMessageById(args.id)
  if (!run || !message || message.run_id !== run.id) {
    throw new Error(`Message ${args.id} is not in this lead's run.`)
  }
  const question = db.getQuestion(args.id)
  if (question?.status === 'closed') {
    throw new Error('Its member is gone, so the reply was not sent.')
  }
  if (question?.status === 'pending') {
    const answered = db.answerQuestion({
      messageId: args.id,
      runId: run.id,
      consumerGeneration: run.consumer_generation,
      body: args.text
    })
    notify(answered.message.to_handle, answered.message.type)
    return { mode: 'answered', question: message.body }
  }
  const override = question?.status === 'answered'
  const sent = db.insertMessage({
    from: lead.handle,
    to: question ? `dispatch:${question.dispatch_id}` : message.from_handle,
    subject: override ? `Override: ${message.subject}` : `Re: ${message.subject}`,
    // Why name the earlier answer: the member already acted on it and must know what changed.
    body: override
      ? `The person overrides your lead's answer "${question.answer_body ?? ''}": ${args.text}`
      : args.text,
    type: 'status',
    priority: 'high',
    threadId: args.id,
    runId: run.id,
    payload: JSON.stringify({ from: 'owner', replyTo: args.id, text: args.text })
  })
  notify(sent.to_handle, sent.type)
  return { mode: override ? 'override' : 'reply', question: message.body }
}

const clipped = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** What the lead hears once, so it records the person's words on the ticket like its own answers. */
export function ownerMemberReplyNote(args: {
  id: string
  ticket: string | null
  text: string
  reply: OwnerMemberReply
}): GameLeadNote {
  const on = args.ticket ? ` ${args.ticket}` : ''
  const verb = {
    answered: `answered${on}`,
    override: `overrode your answer${args.ticket ? ` on ${args.ticket}` : ''}`,
    reply: `replied to${on || ' a member'}`
  }[args.reply.mode]
  return {
    subject: `Owner ${verb}: ${clipped(args.reply.question, 80)}`,
    body: [
      `Answer: ${args.text}`,
      `Question: ${args.reply.question}`,
      args.ticket ? `Record this on ${args.ticket}.` : 'Record this.'
    ].join('\n'),
    payload: {
      ownerMemberReply: args.id,
      mode: args.reply.mode,
      ticket: args.ticket,
      text: args.text
    }
  }
}
