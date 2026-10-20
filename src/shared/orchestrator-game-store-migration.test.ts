import { describe, expect, it } from 'vitest'
import {
  GAME_STORE_VERSION_KEY,
  gameStoreVersionOf,
  migrateGameStore,
  type GameStoreMigration
} from './orchestrator-game-store-migration'

// Test-local steps: no game store has needed a real migration yet.
const renameNote: GameStoreMigration = (data) => {
  const { note, ...rest } = data
  return note === undefined ? rest : { ...rest, notes: [note] }
}
const addTally: GameStoreMigration = (data) => ({ ...data, tally: 0 })

describe('gameStoreVersionOf', () => {
  it('reads a store that never carried a version as version 1', () => {
    expect(gameStoreVersionOf({ records: [] })).toBe(1)
  })

  it('reads the stored version, and nothing that is not a positive integer', () => {
    expect(gameStoreVersionOf({ [GAME_STORE_VERSION_KEY]: 3 })).toBe(3)
    expect(gameStoreVersionOf({ [GAME_STORE_VERSION_KEY]: 0 })).toBeNull()
    expect(gameStoreVersionOf({ [GAME_STORE_VERSION_KEY]: 1.5 })).toBeNull()
    expect(gameStoreVersionOf({ [GAME_STORE_VERSION_KEY]: '2' })).toBeNull()
  })
})

describe('migrateGameStore', () => {
  it('stamps the current version on a store that has none and changes nothing else', () => {
    expect(migrateGameStore({ records: [1] }, [])).toEqual({
      kind: 'current',
      version: 1,
      data: { records: [1], [GAME_STORE_VERSION_KEY]: 1 }
    })
  })

  it('runs every step after the stored version, in order, once', () => {
    const result = migrateGameStore({ note: 'a', keep: true }, [renameNote, addTally])
    expect(result).toEqual({
      kind: 'migrated',
      from: 1,
      version: 3,
      data: { keep: true, notes: ['a'], tally: 0, [GAME_STORE_VERSION_KEY]: 3 }
    })
    if (result.kind !== 'migrated') {
      throw new Error('expected a migration')
    }
    expect(migrateGameStore(result.data, [renameNote, addTally])).toEqual({
      kind: 'current',
      version: 3,
      data: result.data
    })
  })

  it('starts from the stored version, skipping the steps already applied', () => {
    expect(
      migrateGameStore({ notes: ['a'], [GAME_STORE_VERSION_KEY]: 2 }, [renameNote, addTally])
    ).toEqual({
      kind: 'migrated',
      from: 2,
      version: 3,
      data: { notes: ['a'], tally: 0, [GAME_STORE_VERSION_KEY]: 3 }
    })
  })

  it('never reshapes a store a newer build wrote', () => {
    const newer = { future: true, [GAME_STORE_VERSION_KEY]: 5 }
    expect(migrateGameStore(newer, [renameNote])).toEqual({
      kind: 'frozen',
      reason: 'newer',
      version: 5,
      data: newer
    })
  })

  it('leaves the input untouched and reports a step that throws', () => {
    const input = { note: 'a' }
    const broken: GameStoreMigration = () => {
      throw new Error('bad step')
    }
    expect(migrateGameStore(input, [renameNote, broken])).toEqual({
      kind: 'frozen',
      reason: 'failed',
      version: 1,
      data: { note: 'a' },
      error: 'bad step'
    })
    expect(input).toEqual({ note: 'a' })
  })

  it('freezes a store whose version it cannot read', () => {
    expect(migrateGameStore({ [GAME_STORE_VERSION_KEY]: 'two' }, [])).toMatchObject({
      kind: 'frozen',
      reason: 'unreadable-version'
    })
  })
})
