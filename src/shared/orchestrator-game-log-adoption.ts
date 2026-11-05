import { mergeGameCharacters } from './orchestrator-game-characters'
import { GAME_EVENTS_MAX } from './orchestrator-game-events'
import { GAME_HISTORY_MAX } from './orchestrator-game-history'
import type { GameStop } from './orchestrator-game-stop-state'

/** What `orca game adopt-history` carried from an orphaned repo id into the caller's project. */
export type GameHistoryAdoption = {
  from: string
  to: string
  /** Null for each store that held nothing under the old key. */
  history: { records: number; events: number } | null
  lessons: number | null
  stop: GameStop | null
}

/** A project's history file as the store keeps it: raw, so a newer build's entries survive. */
export type GameLogLists = {
  records: unknown[]
  events: unknown[]
  cursors: Record<string, unknown>
  characters: Record<string, unknown> | null
  ownerQuestions: unknown[] | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const timeOf = (one: unknown, field: string): number => {
  const raw = isRecord(one) ? one[field] : undefined
  const ms = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

// Why by content: a second adoption after a crash between write and archive must not count twice.
function unionByTime(
  lists: readonly (readonly unknown[])[],
  field: string,
  keyOf: (one: unknown) => string,
  max: number
): unknown[] {
  const seen = new Set<string>()
  const kept = lists.flat().filter((one) => {
    const key = keyOf(one)
    return seen.has(key) ? false : (seen.add(key), true)
  })
  return kept
    .map((one, index) => ({ one, index, at: timeOf(one, field) }))
    .toSorted((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map(({ one }) => one)
    .slice(-max)
}

const eventKeyOf = (one: unknown): string =>
  isRecord(one) && typeof one.key === 'string' ? `key:${one.key}` : JSON.stringify(one)

/**
 * An orphaned project's log folded into the current one: records and events by time, read cursors
 * at the furthest of the two, characters summed once. Idempotent: adopting the same log twice adds nothing.
 */
export function mergeAdoptedGameLog(current: GameLogLists, adopted: GameLogLists): GameLogLists {
  const cursors: Record<string, unknown> = { ...adopted.cursors }
  for (const [inbox, sequence] of Object.entries(current.cursors)) {
    const before = cursors[inbox]
    cursors[inbox] =
      typeof before === 'number' && typeof sequence === 'number'
        ? Math.max(before, sequence)
        : sequence
  }
  const questions = [...(adopted.ownerQuestions ?? []), ...(current.ownerQuestions ?? [])]
  return {
    records: unionByTime(
      [adopted.records, current.records],
      'endedAt',
      (one) => JSON.stringify(one),
      GAME_HISTORY_MAX
    ),
    events: unionByTime([adopted.events, current.events], 'at', eventKeyOf, GAME_EVENTS_MAX),
    cursors,
    characters:
      current.characters || adopted.characters
        ? mergeGameCharacters(current.characters ?? {}, adopted.characters ?? {})
        : null,
    ownerQuestions:
      questions.length > 0
        ? [...new Map(questions.map((one) => [JSON.stringify(one), one])).values()]
        : current.ownerQuestions
  }
}
