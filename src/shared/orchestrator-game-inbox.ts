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
  /** The newest sequence it holds: what `--mark-read` moves the board's read cursor to. */
  newest: number
}

/** One inbox in `game state`, for the lead and the mod's board. */
export type GameInboxSummary = {
  key: string
  unread: number
  last: { at: string; from: string; subject: string } | null
}

// Why 50: a lead's turn reads it whole; older mail stays in `orca orchestration inbox`.
export const GAME_INBOX_MESSAGES_MAX = 50

const dispatchOfPayload = (payload: string | null): string | null => {
  try {
    const parsed: unknown = payload ? JSON.parse(payload) : null
    return typeof parsed === 'object' &&
      parsed !== null &&
      'dispatchId' in parsed &&
      typeof parsed.dispatchId === 'string'
      ? parsed.dispatchId
      : null
  } catch {
    return null
  }
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
  // Why: heartbeats are liveness, not mail; dozens of them would bury a worker_done past the 50-message cap.
  const byId = new Map(
    source.mail.filter((row) => row.type !== 'heartbeat').map((row) => [row.id, row])
  )
  const oldestFirst = [...byId.values()].sort((a, b) => a.sequence - b.sequence)
  const inboxes = [
    { key: 'lead', addresses: source.leadAddresses },
    ...source.members.map((member) => ({ key: member.ticket, addresses: member.addresses }))
  ]
  return inboxes.map(({ key, addresses }) => {
    const to = new Set(addresses)
    const cursor = cursors[key] ?? 0
    const rows = withoutRepeatedDone(oldestFirst.filter((row) => to.has(row.to_handle)))
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
      newest: rows.at(-1)?.sequence ?? 0
    }
  })
}
