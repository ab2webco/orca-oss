/** The Inbox's view of a project's mail: one thread per ticket, what waits on the lead, and what it answered. */
import {
  isMemberFailure,
  payloadOf,
  type GameInboxMail,
  type GameInboxSource
} from './orchestrator-game-inbox'

export type GameMessageFailure = { kind: 'rejected' | 'failed'; reason: string | null }

export type GameThreadMessage = {
  id: string
  at: string
  /** `lead`, the ticket, or the raw handle of a sender outside the team. */
  from: string
  to: string
  /** The orchestration message type: question, decision_gate, worker_done, escalation, status… */
  kind: string
  subject: string
  body: string
  failure: GameMessageFailure | null
}

export type GameInboxThread = {
  ticket: string
  /** Oldest first, like a chat. */
  messages: GameThreadMessage[]
  last: string
  waiting: number
}

export type GameWaitingItem = {
  id: string
  ticket: string
  kind: 'question' | 'decision_gate'
  subject: string
  body: string
  at: string
  /** Who must answer: `lead`, or a peer lead's label. */
  answerer: string
}

export type GameAnsweredItem = {
  id: string
  ticket: string
  kind: 'question' | 'decision_gate'
  question: string
  answer: string
  askedAt: string
  answeredAt: string
}

export type GameInboxThreads = {
  /** The thread with the newest message first. */
  threads: GameInboxThread[]
  /** Oldest first: the longest wait leads. */
  waiting: GameWaitingItem[]
  /** Newest answer first. */
  answered: GameAnsweredItem[]
}

// Why: the sheet renders a thread whole; older mail stays in `orca game inbox --ticket`.
export const GAME_THREAD_MESSAGES_MAX = 200
export const GAME_ANSWERED_MAX = 100

function failureOf(row: GameInboxMail): GameMessageFailure | null {
  const payload = payloadOf(row.payload)
  const rejection = payload._orcaLifecycleRejection
  if (typeof rejection === 'object' && rejection !== null) {
    const reason = (rejection as Record<string, unknown>).reason
    return { kind: 'rejected', reason: typeof reason === 'string' ? reason : null }
  }
  if (!isMemberFailure(row)) {
    return null
  }
  return { kind: 'failed', reason: typeof payload.reason === 'string' ? payload.reason : null }
}

export function gameInboxThreadsOf(source: GameInboxSource): GameInboxThreads {
  const lead = new Set(source.leadAddresses)
  const labelOf = new Map<string, string>()
  for (const [handle, label] of Object.entries(source.peerLeads ?? {})) {
    labelOf.set(handle, `lead ${label}`)
  }
  const ticketOf = new Map<string, string>()
  for (const member of source.members) {
    for (const address of member.addresses) {
      labelOf.set(address, member.ticket)
      ticketOf.set(address, member.ticket)
    }
  }
  for (const address of source.leadAddresses) {
    labelOf.set(address, 'lead')
  }
  const label = (handle: string): string => labelOf.get(handle) ?? handle
  const rows = [...new Map(source.mail.map((row) => [row.id, row])).values()]
    .sort((a, b) => a.sequence - b.sequence)
    // Why: a rejected heartbeat is a failure the person should see; a plain one is only liveness.
    .filter((row) => row.type !== 'heartbeat' || failureOf(row) !== null)

  const byTicket = new Map<string, GameThreadMessage[]>()
  for (const row of rows) {
    const ticket = ticketOf.get(row.from_handle) ?? ticketOf.get(row.to_handle)
    if (!ticket) {
      continue
    }
    const thread = byTicket.get(ticket) ?? []
    thread.push({
      id: row.id,
      at: row.created_at,
      from: label(row.from_handle),
      to: label(row.to_handle),
      kind: row.type,
      subject: row.subject,
      body: row.body,
      failure: failureOf(row)
    })
    byTicket.set(ticket, thread)
  }

  const leadReplyAfter = (gate: GameInboxMail): GameInboxMail | undefined => {
    const ticket = ticketOf.get(gate.from_handle)
    return rows.find(
      (row) =>
        row.sequence > gate.sequence &&
        lead.has(row.from_handle) &&
        ticketOf.get(row.to_handle) === ticket
    )
  }
  const gates = rows.filter(
    (row) =>
      row.type === 'decision_gate' && ticketOf.has(row.from_handle) && lead.has(row.to_handle)
  )

  const waitingRows = [
    ...(source.pendingQuestions ?? []).filter((row) => lead.has(row.to_handle)),
    ...gates.filter((gate) => !leadReplyAfter(gate))
  ].sort((a, b) => a.sequence - b.sequence)
  const waiting = waitingRows.map(
    (row): GameWaitingItem => ({
      id: row.id,
      ticket: label(row.from_handle),
      kind: row.type === 'decision_gate' ? 'decision_gate' : 'question',
      subject: row.subject,
      body: row.body,
      at: row.created_at,
      answerer: label(row.to_handle)
    })
  )

  const answeredQuestions = (source.answeredQuestions ?? []).flatMap((row): GameAnsweredItem[] =>
    row.answer_body !== null && row.answered_at !== null
      ? [
          {
            id: row.id,
            ticket: label(row.from_handle),
            kind: 'question',
            question: row.body,
            answer: row.answer_body,
            askedAt: row.created_at,
            answeredAt: row.answered_at
          }
        ]
      : []
  )
  const answeredGates = gates.flatMap((gate): GameAnsweredItem[] => {
    const reply = leadReplyAfter(gate)
    return reply
      ? [
          {
            id: gate.id,
            ticket: label(gate.from_handle),
            kind: 'decision_gate',
            question: gate.body,
            answer: reply.body,
            askedAt: gate.created_at,
            answeredAt: reply.created_at
          }
        ]
      : []
  })
  const answered = [...answeredQuestions, ...answeredGates]
    .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))
    .slice(0, GAME_ANSWERED_MAX)

  const threads = [...byTicket].map(
    ([ticket, messages]): GameInboxThread => ({
      ticket,
      messages: messages.slice(-GAME_THREAD_MESSAGES_MAX),
      last: messages.at(-1)?.at ?? '',
      waiting: waiting.filter((item) => item.ticket === ticket).length
    })
  )
  threads.sort((a, b) => b.last.localeCompare(a.last))
  return { threads, waiting, answered }
}
