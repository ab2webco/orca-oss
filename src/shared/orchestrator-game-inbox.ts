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
  /** The thread this message belongs to. */
  thread_id?: string | null
  /** The message `orchestration reply` answered; absent from older builds and plain sends. */
  reply_to?: string | null
  run_id?: string | null
  delivery_contract?: string | null
}

/** Every address mail to the lead or to a ticket's member ever went to, and that mail. */
export type GameInboxSource = {
  /** The lead's terminal and its run mailbox. */
  leadAddresses: readonly string[]
  /** The lead's terminal now: mail to an older handle of the lead's cannot be replied to. */
  leadHandle?: string
  /** Each ticket's terminals and dispatch mailboxes, closed ones included; `ticket` is the name when it has none. */
  members: readonly { ticket: string; addresses: readonly string[] }[]
  mail: readonly GameInboxMail[]
  /** Other projects' lead handles to their labels, for mail a peer lead sent. */
  peerLeads?: Readonly<Record<string, string>>
  /** Questions of this run still awaiting an answer, whatever mail window they fall outside. */
  pendingQuestions?: readonly GameInboxMail[]
  /** Questions of this run the lead answered, with the answer; the Inbox audits them. */
  answeredQuestions?: readonly GameAnsweredQuestionMail[]
  /** Addresses of members game stop released, that no live member shares: nobody can act on an answer. */
  releasedSenders?: readonly string[]
  /** Mail to the owner: the lead's replies to owner answers, read only for the threads they close (ORCA-1431). */
  ownerReplies?: readonly GameInboxMail[]
}

export type GameAnsweredQuestionMail = GameInboxMail & {
  answer_body: string | null
  answered_at: string | null
}

/** Why `orchestration reply` cannot settle a waiting row, so the lead settles it with a note (ORCA-1482). */
export type GameStuckReason = 'legacy_run' | 'reminted_lead' | 'gone_sender'

/** A question a member asked that nobody has answered: it waits on the lead until it is. */
export type GameWaitingMessage = {
  id: string
  /** The asking ticket, or the raw handle of a sender outside the team. */
  from: string
  subject: string
  at: string
  /** Set only when no reply can settle it: `game inbox --settle` does. */
  stuck?: GameStuckReason
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

const WAITS_ON_LEAD: ReadonlySet<string> = new Set(['escalation', 'decision_gate'])

// Why a copy: shared code cannot import the main process's ORCHESTRATION_LEGACY_RUN_ID.
const GAME_LEGACY_RUN_ID = 'run_legacy_local'

/** The handle Orca sends the person's answers to the lead from. */
export const GAME_OWNER_HANDLE = 'owner'

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

/** Mail from a released member: nobody can act on an answer, so it no longer waits on the lead (ORCA-1267). */
export function releasedSenderOf(source: GameInboxSource): (row: GameInboxMail) => boolean {
  const gone = new Set(source.releasedSenders ?? [])
  return (row) => {
    const dispatch = dispatchOfPayload(row.payload)
    return gone.has(row.from_handle) || (dispatch !== null && gone.has(`dispatch:${dispatch}`))
  }
}

/** The rows mail settles: the one a reply names, else, for a plain send or an older build's reply, its thread. */
export function repliedIdsOf(rows: readonly GameInboxMail[]): Set<string> {
  // Why the exact row first (ORCA-1481): a reply to a threaded escalation carries its thread id, not the row's.
  return new Set(
    rows.flatMap((row) => (row.reply_to ? [row.reply_to] : row.thread_id ? [row.thread_id] : []))
  )
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

const ticketOfAddress = (source: GameInboxSource): Map<string, string> =>
  new Map(
    source.members.flatMap((member) =>
      member.addresses.map((address) => [address, member.ticket] as const)
    )
  )

// Why: heartbeats are liveness, not mail; dozens of them would bury a worker_done past the 50-message cap.
function mailOldestFirstOf(source: GameInboxSource): GameInboxMail[] {
  const all = [...new Map(source.mail.map((row) => [row.id, row])).values()].sort(
    (a, b) => a.sequence - b.sequence
  )
  return withoutSupersededFailures(all, ticketOfAddress(source)).filter(
    (row) => row.type !== 'heartbeat'
  )
}

/**
 * What waits on the lead, oldest first: the one set `game watch --lead` alerts on and the Inbox's
 * Waiting list shows (ORCA-1482). A member escalation or gate waits like a question until a reply
 * names it (ORCA-1154, ORCA-1481); an owner answer until the lead reads it (ORCA-1431).
 */
export function leadWaitingRowsOf(
  source: GameInboxSource,
  oldestFirst: readonly GameInboxMail[] = mailOldestFirstOf(source)
): GameInboxMail[] {
  const lead = new Set(source.leadAddresses)
  // Why every mail row, not only the window kept: a reply older than a superseded failure still settles.
  const replied = repliedIdsOf([...source.mail, ...(source.ownerReplies ?? [])])
  const fromReleased = releasedSenderOf(source)
  const unanswered = oldestFirst.filter(
    (row) =>
      lead.has(row.to_handle) &&
      WAITS_ON_LEAD.has(row.type) &&
      !replied.has(row.id) &&
      !fromReleased(row) &&
      !(row.from_handle === GAME_OWNER_HANDLE && row.read !== 0)
  )
  const pending = (source.pendingQuestions ?? []).filter((row) => lead.has(row.to_handle))
  return [...new Map([...pending, ...unanswered].map((row) => [row.id, row])).values()].sort(
    (a, b) => a.sequence - b.sequence
  )
}

// Why these three: `orchestration reply` refuses a legacy Run's mail and mail to a lead handle no
// pane holds, and a reply to a sender outside the team reaches nobody (ORCA-1475 C12).
export function stuckReasonOf(
  source: GameInboxSource
): (row: GameInboxMail) => GameStuckReason | null {
  const ticketOf = ticketOfAddress(source)
  const known = new Set([
    GAME_OWNER_HANDLE,
    ...source.leadAddresses,
    ...Object.keys(source.peerLeads ?? {})
  ])
  return (row) => {
    if (row.type === 'question') {
      return null
    }
    if (
      row.run_id === GAME_LEGACY_RUN_ID ||
      row.delivery_contract === 'legacy_direct' ||
      row.delivery_contract === 'audit_only'
    ) {
      return 'legacy_run'
    }
    if (
      source.leadHandle &&
      !row.to_handle.startsWith('run:') &&
      row.to_handle !== source.leadHandle
    ) {
      return 'reminted_lead'
    }
    const dispatch = dispatchOfRow(row)
    const member =
      ticketOf.has(row.from_handle) || (dispatch !== null && ticketOf.has(`dispatch:${dispatch}`))
    return member || known.has(row.from_handle) ? null : 'gone_sender'
  }
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
  const oldestFirst = mailOldestFirstOf(source)
  const inboxes = [
    { key: 'lead', addresses: source.leadAddresses },
    ...source.members.map((member) => ({ key: member.ticket, addresses: member.addresses }))
  ]
  const waitingOnLead = leadWaitingRowsOf(source, oldestFirst)
  const stuck = stuckReasonOf(source)
  return inboxes.map(({ key, addresses }) => {
    const to = new Set(addresses)
    const cursor = cursors[key] ?? 0
    const rows = withoutRepeatedDone(oldestFirst.filter((row) => to.has(row.to_handle)))
    const waiting = (
      key === 'lead'
        ? waitingOnLead
        : (source.pendingQuestions ?? [])
            .filter((row) => to.has(row.to_handle))
            .sort((a, b) => a.sequence - b.sequence)
    ).map((row): GameWaitingMessage => {
      const reason = stuck(row)
      return {
        id: row.id,
        from: labelOf.get(row.from_handle) ?? row.from_handle,
        subject: row.subject,
        at: row.created_at,
        ...(reason ? { stuck: reason } : {})
      }
    })
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
