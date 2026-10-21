/**
 * Versioned migrations for the game's app-owned JSON stores. Step `i` turns version `i + 1` into
 * `i + 2`, so a store's current version is `migrations.length + 1`. Steps are pure and ordered;
 * ADDING an optional field needs no step, since every reader keeps what it does not know.
 */

export const GAME_STORE_VERSION_KEY = 'schemaVersion'

export type GameStoreData = Record<string, unknown>
export type GameStoreMigration = (data: GameStoreData) => GameStoreData

export type GameStoreMigrationResult =
  | { kind: 'current'; version: number; data: GameStoreData }
  | { kind: 'migrated'; from: number; version: number; data: GameStoreData }
  /** Left as stored: written by a newer build, or a step failed. Writers keep its shape. */
  | {
      kind: 'frozen'
      reason: 'newer' | 'failed' | 'unreadable-version'
      version: number | null
      data: GameStoreData
      error?: string
    }

/** A store written before versions existed is version 1; null when the field is not a version. */
export function gameStoreVersionOf(data: GameStoreData): number | null {
  const raw = data[GAME_STORE_VERSION_KEY]
  if (raw === undefined) {
    return 1
  }
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null
}

export function migrateGameStore(
  data: GameStoreData,
  migrations: readonly GameStoreMigration[]
): GameStoreMigrationResult {
  const current = migrations.length + 1
  const from = gameStoreVersionOf(data)
  if (from === null) {
    return { kind: 'frozen', reason: 'unreadable-version', version: null, data }
  }
  if (from > current) {
    return { kind: 'frozen', reason: 'newer', version: from, data }
  }
  let next: GameStoreData = structuredClone(data)
  try {
    for (const step of migrations.slice(from - 1)) {
      next = step(next)
    }
  } catch (error) {
    return {
      kind: 'frozen',
      reason: 'failed',
      version: from,
      data,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  const stamped = { ...next, [GAME_STORE_VERSION_KEY]: current }
  return from === current
    ? { kind: 'current', version: current, data: stamped }
    : { kind: 'migrated', from, version: current, data: stamped }
}
