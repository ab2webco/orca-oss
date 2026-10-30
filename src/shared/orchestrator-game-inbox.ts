/** `orca game inbox`: the orchestration mail of a project's lead and of each ticket, which outlives a closed member. */

/** One orchestration message row, as the Orca host's orchestration database keeps it. */
export type GameInboxMail = {
  id: string
  from_handle: string
  to_handle: string
  subject: string
  body: string
  type: string
  read: number
  sequence: number
  created_at: string
  payload: string | null
  /** The question or message this one answers. */
  thread_id?: string | null
}

/** Every address mail to the lead or to a ticket's member ever went to, and that mail. */
export type GameInboxSource = {
  /** The lead's terminal and its run mailbox. */
  leadAddresses: readonly string[]
  /** Each ticket's terminals and dispatch mailboxes, closed ones included. */
  members: readonly { ticket: string; addresses: readonly string[] }[]
  mail: readonly GameInboxMail[]
  /** Other projects' lead handles to their labels, for mail a peer lead sent. */
  peerLeads?: Readonly<Record<string, string>>
  /** Questions of this run still awaiting an answer, whatever mail window they fall outside. */
  pendingQuestions?: readonly GameInboxMail[]
  /** Questions of this run the lead answered, with the answer; the Inbox audits them. */
  answeredQuestions?: readonly GameAnsweredQuestionMail[]
}

export type GameAnsweredQuestionMail = GameInboxMail & {
  answer_body: string | null
  answered_at: string | null
}

/** A question a member asked that nobody has answered: it waits on the lead until it is. */
export type GameWaitingMessage = {
  id: string
  /** The asking ticket, or the raw handle of a sender outside the team. */
  from: string
  subject: string
  at: string
}

export type GameInboxMessage = {
  id: string
  at: string
  /** `lead`, a ticket, or the raw handle of a sender outside the team. */
  from: string
  to: string
  type: string
  subject: string
  body: string
  unread: boolean
}

export type GameInbox = {
  /** `lead` or a ticket. */
  key: string
  unread: number
  messages: GameInboxMessage[]
  /** Unanswered questions in this inbox, oldest first; kept past the message cap. */
  waiting: GameWaitingMessage[]
  /** The newest sequence it holds: what `--mark-read` moves the board's read cursor to. */
  newest: number
}

/** One inbox in `game state`, for the lead and the mod's board. */
export type GameInboxSummary = {
  key: string
  unread: number
  last: { at: string; from: string; subject: string } | null
  waiting: GameWaitingMessage[]
}

// Why 50: a lead's turn reads it whole; older mail stays in `orca orchestration inbox`.
export const GAME_INBOX_MESSAGES_MAX = 50

export const payloadOf = (payload: string | null): Record<string, unknown> => {
  try {
    const parsed: unknown = payload ? JSON.parse(payload) : null
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const dispatchOfPayload = (payload: string | null): string | null => {
  const dispatchId = payloadOf(payload).dispatchId
  return typeof dispatchId === 'string' ? dispatchId : null
}

// Why: a worker_done can be sent twice (a retried send, the member and a watcher); the lead acts on it once.
function withoutRepeatedDone(rows: readonly GameInboxMail[]): GameInboxMail[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (row.type !== 'worker_done') {
      return true
    }
    const key = dispatchOfPayload(row.payload) ?? row.from_handle
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const dispatchOfRow = (row: GameInboxMail): string | null =>
  dispatchOfPayload(row.payload) ??
  (row.from_handle.startsWith('dispatch:') ? row.from_handle.slice('dispatch:'.length) : null)

export const isMemberFailure = (row: GameInboxMail): boolean => {
  const payload = payloadOf(row.payload)
  return (
    payload.setupState === 'failed' ||
    payload.reason === 'first_signal_deadline_expired' ||
    (row.type === 'escalation' && typeof payload.exitCode === 'number') ||
    (row.type === 'worker_done' && payload.outcome === 'failed')
  )
}

// Why: a failure the ticket already got past (a later success, or a relaunched dispatch talking) needs no action from the lead.
function withoutSupersededFailures(
  rows: readonly GameInboxMail[],
  ticketOf: ReadonlyMap<string, string>
): GameInboxMail[] {
  const superseded = new Set<string>()
  for (const failure of rows) {
    const ticket = ticketOf.get(failure.from_handle)
    if (!ticket || !isMemberFailure(failure)) {
      continue
    }
    const failedDispatch = dispatchOfRow(failure)
    const later = rows.filter(
      (row) => row.sequence > failure.sequence && ticketOf.get(row.from_handle) === ticket
    )
    const passed = later.some((row) => {
      if (row.type === 'worker_done' && payloadOf(row.payload).outcome === 'succeeded') {
        return true
      }
      const dispatch = dispatchOfRow(row)
      // Why (ORCA-658): the host reopened this very dispatch, so its failure no longer holds.
      if (
        dispatch === failedDispatch &&
        payloadOf(row.payload).reason === 'reattached_by_activity'
      ) {
        return true
      }
      return failedDispatch !== null && dispatch !== null && dispatch !== failedDispatch
    })
    if (passed) {
      superseded.add(failure.id)
    }
  }
  return rows.filter((row) => !superseded.has(row.id))
}

/** The lead's inbox first, then one per ticket; a message is unread until an agent read it or the board's cursor passed it. */
export function gameInboxesOf(
  source: GameInboxSource,
  cursors: Readonly<Record<string, number>>
): GameInbox[] {
  const labelOf = new Map<string, string>()
  for (const [handle, label] of Object.entries(source.peerLeads ?? {})) {
    labelOf.set(handle, `lead ${label}`)
  }
  for (const member of source.members) {
    for (const address of member.addresses) {
      labelOf.set(address, member.ticket)
    }
  }
  for (const address of source.leadAddresses) {
    labelOf.set(address, 'lead')
  }
  const ticketOf = new Map(
    source.members.flatMap((member) =>
      member.addresses.map((address) => [address, member.ticket] as const)
    )
  )
  const allOldestFirst = [...new Map(source.mail.map((row) => [row.id, row])).values()].sort(
    (a, b) => a.sequence - b.sequence
  )
  // Why: heartbeats are liveness, not mail; dozens of them would bury a worker_done past the 50-message cap.
  const oldestFirst = withoutSupersededFailures(allOldestFirst, ticketOf).filter(
    (row) => row.type !== 'heartbeat'
  )
  const inboxes = [
    { key: 'lead', addresses: source.leadAddresses },
    ...source.members.map((member) => ({ key: member.ticket, addresses: member.addresses }))
  ]
  const pending = source.pendingQuestions ?? []
  return inboxes.map(({ key, addresses }) => {
    const to = new Set(addresses)
    const cursor = cursors[key] ?? 0
    const rows = withoutRepeatedDone(oldestFirst.filter((row) => to.has(row.to_handle)))
    const waiting = pending
      .filter((row) => to.has(row.to_handle))
      .map(
        (row): GameWaitingMessage => ({
          id: row.id,
          from: labelOf.get(row.from_handle) ?? row.from_handle,
          subject: row.subject,
          at: row.created_at
        })
      )
    const messages = rows.toReversed().map(
      (row): GameInboxMessage => ({
        id: row.id,
        at: row.created_at,
        from: labelOf.get(row.from_handle) ?? row.from_handle,
        to: key,
        type: row.type,
        subject: row.subject,
        body: row.body,
        unread: row.read === 0 && row.sequence > cursor
      })
    )
    return {
      key,
      unread: messages.filter((one) => one.unread).length,
      messages: messages.slice(0, GAME_INBOX_MESSAGES_MAX),
      waiting,
      newest: rows.at(-1)?.sequence ?? 0
    }
  })
}
