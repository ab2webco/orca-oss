import type { TeamMemberRow } from './team-drawer-model'

type Rec = Record<string, unknown>
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

function heldRowOf(raw: Rec, hold: NonNullable<TeamMemberRow['hold']>): TeamMemberRow | null {
  const ticket = text(raw.ticket)?.toUpperCase()
  if (!ticket) {
    return null
  }
  const since = hold.kind === 'paused' ? Date.parse(text(raw.since) ?? '') : Number.NaN
  return {
    key: `${hold.kind}:${ticket}`,
    name: text(raw.name) ?? ticket,
    ticket,
    title: null,
    state: 'idle',
    needsYou: false,
    host: null,
    agent: text(raw.agent),
    model: null,
    pr: null,
    ticketStatus: null,
    live: null,
    since: Number.isNaN(since) ? null : since,
    phase: null,
    summary: null,
    terminal: null,
    account: null,
    limit: null,
    hold
  }
}

/** Members a STOP paused and launches waiting in the queue, as the desktop's offline cards read them. */
export function teamHeldMemberRowsOf(state: Rec): TeamMemberRow[] {
  const list = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter(isRecord) : [])
  const rows = [
    ...list(state.pausedMembers).map((one) => heldRowOf(one, { kind: 'paused' })),
    ...list(state.queuedMembers).map((one) =>
      heldRowOf(one, { kind: 'queued', waitingOn: text(one.waitingOn) ?? '' })
    )
  ].filter((one): one is TeamMemberRow => one !== null)
  // Why by key: a queued launch shows once, even if a host lists it twice (ORCA-1172).
  return rows.filter((one, at) => rows.findIndex((other) => other.key === one.key) === at)
}
