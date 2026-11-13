import type { GameStoreData } from '../../shared/orchestrator-game-store-migration'

// A project file's lists as the history store reads them.

// Why raw: entries and keys this build cannot read were written by a newer one, and a rewrite
// that dropped them would cost that history after a one-release downgrade.
export type ProjectLog = {
  data: GameStoreData
  records: unknown[]
  events: unknown[]
  /** Per inbox (`lead` or a ticket), the newest orchestration message sequence the board marked read. */
  cursors: Record<string, unknown>
  /** Per character key, its saved progress; absent until a member with a character is freed. */
  characters: Record<string, unknown> | null
  /** What the lead asked the person; absent until the first question. */
  ownerQuestions: unknown[] | null
  /** Saved arcade plays; absent until the first perfect merge recorded after this build. */
  arcade: Record<string, unknown> | null
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const listOf = (data: GameStoreData, key: string): unknown[] => {
  const list = data[key]
  return Array.isArray(list) ? list : []
}

export function cursorsOf(raw: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, number] =>
        entry[0].length <= 40 && typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )
  )
}

export function logOf(data: GameStoreData): ProjectLog {
  return {
    data,
    records: listOf(data, 'records'),
    events: listOf(data, 'events'),
    cursors: isRecord(data.cursors) ? data.cursors : {},
    characters: isRecord(data.characters) ? data.characters : null,
    ownerQuestions: Array.isArray(data.ownerQuestions) ? data.ownerQuestions : null,
    arcade: isRecord(data.arcade) ? data.arcade : null
  }
}
