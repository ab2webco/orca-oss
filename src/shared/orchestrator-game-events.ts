import type { GameReview } from './orchestrator-game-state'

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

/** The review a `merged` event stands for, so the lead earns it after the member is freed (ORCA-887). */
export type GameEventMerge = {
  provider: GameReview['provider']
  number: number
  worktreeId: string
  perfect: boolean
}

/** A member's merge as the lead's game state lists it: the event's key and ticket with its review. */
export type GameMerge = GameEventMerge & { key: string; ticket: string | null }

export type GameEvent = {
  at: string
  kind: GameEventKind
  ticket: string | null
  text: string | null
  /** Who posted it: `lead`, a member's ticket, or `orca`. */
  by: string | null
  /** An event with a key is kept once: what sweep and fleet observe again on every run. */
  key?: string
  /** Set only on a `merged` event the host observed. */
  merge?: GameEventMerge
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

const MERGE_PROVIDERS: readonly GameReview['provider'][] = [
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
  'gitea'
]

// Why its own null: a merge record this build cannot read costs the event its rewards, not its line.
const mergeOf = (raw: unknown): GameEventMerge | null => {
  if (
    !isRecord(raw) ||
    !MERGE_PROVIDERS.some((one) => one === raw.provider) ||
    !Number.isInteger(raw.number) ||
    typeof raw.worktreeId !== 'string' ||
    raw.worktreeId === '' ||
    raw.worktreeId.length > SHORT_MAX ||
    typeof raw.perfect !== 'boolean'
  ) {
    return null
  }
  return {
    provider: raw.provider as GameReview['provider'],
    number: raw.number as number,
    worktreeId: raw.worktreeId,
    perfect: raw.perfect
  }
}

/** The newest `limit` merges events record, oldest first. */
export function gameMergesOf(events: readonly GameEvent[], limit: number): GameMerge[] {
  return events
    .flatMap((one): GameMerge[] =>
      one.kind === 'merged' && one.merge && one.key
        ? [{ ...one.merge, key: one.key, ticket: one.ticket }]
        : []
    )
    .slice(-limit)
}

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
  const merge = raw.kind === 'merged' ? mergeOf(raw.merge) : null
  return {
    at: raw.at,
    kind: raw.kind,
    ticket,
    text,
    by,
    ...(key === null ? {} : { key }),
    ...(merge ? { merge } : {})
  }
}
