/** What happened in a project's game, one line per change: `orca game events`. */

export const GAME_EVENT_KINDS = [
  'claimed',
  'pr_opened',
  'merged',
  'qa_handoff',
  'question_parked',
  'failed',
  'stopped',
  'resumed'
] as const
export type GameEventKind = (typeof GAME_EVENT_KINDS)[number]

export type GameEvent = {
  at: string
  kind: GameEventKind
  ticket: string | null
  text: string | null
  /** Who posted it: `lead`, a member's ticket, or `orca`. */
  by: string | null
  /** An event with a key is kept once: what sweep and fleet observe again on every run. */
  key?: string
}

// Why 500: days of a busy project's events, small enough to read whole on every call.
export const GAME_EVENTS_MAX = 500
const SHORT_MAX = 120
export const GAME_EVENT_TEXT_MAX = 600

export function isGameEventKind(value: unknown): value is GameEventKind {
  return GAME_EVENT_KINDS.some((kind) => kind === value)
}

/** `T` lets the store keep, as they were, the events a newer build wrote. */
export function appendGameEvent<T = GameEvent>(
  events: readonly T[],
  event: GameEvent
): { events: (T | GameEvent)[]; added: boolean } {
  const keyOf = (one: T): unknown => (isRecord(one) ? one.key : undefined)
  if (event.key !== undefined && events.some((one) => keyOf(one) === event.key)) {
    return { events: [...events], added: false }
  }
  return { events: [...events, event].slice(-GAME_EVENTS_MAX), added: true }
}

/** Newest first; `since` is any date `Date.parse` reads. */
export function filterGameEvents(
  events: readonly GameEvent[],
  filter: { ticket?: string; since?: string }
): GameEvent[] {
  const ticket = filter.ticket?.trim().toUpperCase()
  const since = filter.since ? Date.parse(filter.since) : Number.NaN
  return events
    .filter((one) => !ticket || one.ticket === ticket)
    .filter((one) => Number.isNaN(since) || Date.parse(one.at) >= since)
    .toReversed()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown, max: number): string | null | undefined => {
  if (value === null || value === undefined) {
    return null
  }
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

/** An event as it arrives over RPC or from disk; null when any field is malformed. */
export function parseGameEvent(raw: unknown): GameEvent | null {
  if (
    !isRecord(raw) ||
    typeof raw.at !== 'string' ||
    Number.isNaN(Date.parse(raw.at)) ||
    !isGameEventKind(raw.kind)
  ) {
    return null
  }
  const ticket = textOrNull(raw.ticket, SHORT_MAX)
  const text = textOrNull(raw.text, GAME_EVENT_TEXT_MAX)
  const by = textOrNull(raw.by, SHORT_MAX)
  const key = textOrNull(raw.key, SHORT_MAX)
  if (ticket === undefined || text === undefined || by === undefined || key === undefined) {
    return null
  }
  return { at: raw.at, kind: raw.kind, ticket, text, by, ...(key === null ? {} : { key }) }
}
