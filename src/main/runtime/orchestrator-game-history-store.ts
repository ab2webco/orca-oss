import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  appendGameHistory,
  parseGameHistoryRecord,
  type GameHistoryRecord
} from '../../shared/orchestrator-game-history'
import {
  appendGameEvent,
  parseGameEvent,
  type GameEvent
} from '../../shared/orchestrator-game-events'
import {
  foldFreedMember,
  listGameCharacters,
  type GameCharacter
} from '../../shared/orchestrator-game-characters'
import {
  migrateGameStore,
  type GameStoreMigration
} from '../../shared/orchestrator-game-store-migration'
import { mergeAdoptedGameLog } from '../../shared/orchestrator-game-log-adoption'
import {
  earnGameArcadeCredit,
  parseGameArcadeCredits,
  type GameArcadeCredits
} from '../../shared/orchestrator-game-arcade-credits'
import { adoptedArcadeFields, migratedArcadeFields } from './orchestrator-game-history-arcade'
import { cursorsOf, isRecord, logOf, type ProjectLog } from './orchestrator-game-history-log'
import type { GameStoreNaming } from './orchestrator-game-store-names'

/** Ordered steps for this store's file; empty while version 1 is the only shape. */
export const GAME_HISTORY_MIGRATIONS: readonly GameStoreMigration[] = []

type LoadedLog = {
  log: ProjectLog
  /** What a write must do first: set a damaged file aside, or back up the shape it migrates. */
  before:
    | { kind: 'none' }
    | { kind: 'damaged' }
    | { kind: 'migrated'; from: number }
    /** A frozen file whose lists this build cannot hold: a write would replace them. */
    | { kind: 'read-only' }
}

// Why bounded: one cursor per ticket ever launched would grow without end.
const CURSORS_MAX = 200

const fileStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

/** Each project's member history and event record, one bounded JSON file per project on the Orca host. */
export class GameHistoryStore {
  // Why per project: two writes to one file must not read the same old list and drop a record.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dirOf: () => string,
    private readonly migrations: readonly GameStoreMigration[] = GAME_HISTORY_MIGRATIONS,
    private readonly names?: GameStoreNaming
  ) {}

  async list(projectKey: string): Promise<GameHistoryRecord[]> {
    const { log } = await this.read(projectKey)
    return log.records.flatMap((one) => parseGameHistoryRecord(one) ?? [])
  }

  async events(projectKey: string): Promise<GameEvent[]> {
    const { log } = await this.read(projectKey)
    return log.events.flatMap((one) => parseGameEvent(one) ?? [])
  }

  async cursors(projectKey: string): Promise<Record<string, number>> {
    return cursorsOf((await this.read(projectKey)).log.cursors)
  }

  /** Moves an inbox's read cursor forward, never back. */
  async markInboxRead(projectKey: string, inbox: string, sequence: number): Promise<void> {
    await this.update(projectKey, (current) => {
      if ((cursorsOf(current.cursors)[inbox] ?? 0) >= sequence) {
        return null
      }
      const { [inbox]: _old, ...others } = current.cursors
      const kept = Object.entries(others).slice(-(CURSORS_MAX - 1))
      return { ...current, cursors: { ...Object.fromEntries(kept), [inbox]: sequence } }
    })
  }

  async characters(projectKey: string): Promise<GameCharacter[]> {
    return listGameCharacters((await this.read(projectKey)).log.characters ?? {})
  }

  /** With `character`, the same write adds the record's task to that character's progress. */
  async append(
    projectKey: string,
    record: GameHistoryRecord,
    character?: { key: string; name: string }
  ): Promise<GameHistoryRecord[]> {
    const log = await this.update(projectKey, (current) => {
      const characters = character
        ? (foldFreedMember(current.characters ?? {}, character, record) ?? current.characters)
        : current.characters
      return { ...current, records: appendGameHistory(current.records, record), characters }
    })
    return log.records.flatMap((one) => parseGameHistoryRecord(one) ?? [])
  }

  /** `added` is false when an event with the same key is already kept; a new perfect merge saves a credit. */
  async appendEvent(projectKey: string, event: GameEvent): Promise<{ added: boolean }> {
    let added = false
    await this.update(projectKey, (current) => {
      const next = appendGameEvent(current.events, event)
      added = next.added
      if (!next.added) {
        return null
      }
      const arcade = event.merge?.perfect
        ? earnGameArcadeCredit(parseGameArcadeCredits(current.arcade), event.merge)
        : null
      return { ...current, events: next.events, ...(arcade && { arcade }) }
    })
    return { added }
  }

  /** `change` sees the characters and records as kept, and returns null characters to leave them. */
  async changeCharacters<R>(
    projectKey: string,
    change: (
      characters: Record<string, unknown>,
      records: unknown[]
    ) => { next: Record<string, unknown> | null; result: R }
  ): Promise<R> {
    let result: R | undefined
    await this.update(projectKey, (current) => {
      const changed = change(current.characters ?? {}, current.records)
      result = changed.result
      return changed.next ? { ...current, characters: changed.next } : null
    })
    return result as R
  }

  async arcade(projectKey: string): Promise<GameArcadeCredits> {
    return parseGameArcadeCredits((await this.read(projectKey)).log.arcade)
  }

  /** `change` returns a null ledger to leave the file as it is. */
  async changeArcade<R>(
    projectKey: string,
    change: (current: GameArcadeCredits) => { next: GameArcadeCredits | null; result: R }
  ): Promise<R> {
    let result: R | undefined
    await this.update(projectKey, (current) => {
      const changed = change(parseGameArcadeCredits(current.arcade))
      result = changed.result
      return changed.next ? { ...current, arcade: changed.next } : null
    })
    return result as R
  }

  /** Pays the terminal's kept offers once; the paid ids ride in the file, so a restart pays none again. */
  async migrateArcadeOffers(
    projectKey: string,
    offers: readonly unknown[]
  ): Promise<{ paid: number; arcade: GameArcadeCredits }> {
    let paid = 0
    const log = await this.update(projectKey, (current) => {
      const migrated = migratedArcadeFields(current, offers)
      paid = migrated.paid
      return migrated.fields && { ...current, ...migrated.fields }
    })
    return { paid, arcade: parseGameArcadeCredits(log.arcade) }
  }

  async ownerQuestions(projectKey: string): Promise<unknown[]> {
    return (await this.read(projectKey)).log.ownerQuestions ?? []
  }

  /** `change` returns a null list to leave the file as it is. */
  async changeOwnerQuestions<R>(
    projectKey: string,
    change: (list: readonly unknown[]) => { list: unknown[] | null; result: R }
  ): Promise<R> {
    let result: R | undefined
    await this.update(projectKey, (current) => {
      const next = change(current.ownerQuestions ?? [])
      result = next.result
      return next.list ? { ...current, ownerQuestions: next.list } : null
    })
    return result as R
  }

  /**
   * Folds another key's file into this key's, then sets that file aside so a second run finds
   * nothing. Null when that key has no file; throws, touching neither, when it cannot be read.
   */
  async adopt(fromKey: string, toKey: string): Promise<{ records: number; events: number } | null> {
    const from = this.fileOf(fromKey)
    if (
      !(await stat(from).then(
        () => true,
        () => false
      ))
    ) {
      return null
    }
    const { log, before } = await this.read(fromKey)
    if (before.kind === 'damaged' || before.kind === 'read-only') {
      throw new Error(`The history under ${fromKey} cannot be read; it was left as it is.`)
    }
    if ((await this.read(toKey)).before.kind === 'read-only') {
      throw new Error(
        `The history under ${toKey} was written by a newer Orca; nothing was adopted.`
      )
    }
    await this.update(toKey, (current) => ({
      ...current,
      ...mergeAdoptedGameLog(current, log),
      ...adoptedArcadeFields(current, log)
    }))
    await rename(from, this.besideOf(fromKey, `adopted-${fileStamp()}`))
    return { records: log.records.length, events: log.events.length }
  }

  // Why migrate only in memory here: reads run outside the queue, so only update() may persist.
  private async read(projectKey: string): Promise<LoadedLog> {
    let text: string
    try {
      text = await readFile(this.fileOf(projectKey), 'utf8')
    } catch {
      return this.fresh()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!isRecord(parsed)) {
      // Why: a damaged file must cost the history, never the stop or sweep that writes it.
      return { log: this.fresh().log, before: { kind: 'damaged' } }
    }
    const result = migrateGameStore(parsed, this.migrations)
    if (result.kind === 'frozen') {
      const fits =
        ['records', 'events', 'ownerQuestions'].every(
          (key) => !(key in parsed) || Array.isArray(parsed[key])
        ) &&
        ['cursors', 'characters', 'arcade'].every(
          (key) => !(key in parsed) || isRecord(parsed[key])
        )
      return { log: logOf(parsed), before: { kind: fits ? 'none' : 'read-only' } }
    }
    return {
      log: logOf(result.data),
      before:
        result.kind === 'migrated' ? { kind: 'migrated', from: result.from } : { kind: 'none' }
    }
  }

  private fresh(): LoadedLog {
    return { log: logOf(migrateGameStore({}, this.migrations).data), before: { kind: 'none' } }
  }

  /** `change` returns null to leave the file as it is. */
  private update(
    projectKey: string,
    change: (current: ProjectLog) => ProjectLog | null
  ): Promise<ProjectLog> {
    const previous = this.queues.get(projectKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const { log: current, before } = await this.read(projectKey)
        const log = change(current)
        // Why skip read-only: losing this one entry beats wiping what a newer build stored.
        if (!log || before.kind === 'read-only') {
          return current
        }
        await mkdir(this.dirOf(), { recursive: true })
        const file = this.fileOf(projectKey)
        if (before.kind === 'damaged') {
          await rename(file, this.besideOf(projectKey, `damaged-${fileStamp()}`))
        } else if (before.kind === 'migrated') {
          // Why a copy, not a rename: until the migrated file lands, the old one stays readable.
          await copyFile(file, this.besideOf(projectKey, `v${before.from}-${fileStamp()}.backup`))
        }
        const { data, records, events, cursors, characters, ownerQuestions, arcade } = log
        await writeFileDurable(
          durableWriteTempPath(file),
          file,
          JSON.stringify({
            ...data,
            records,
            events,
            cursors,
            ...(characters && { characters }),
            ...(ownerQuestions && { ownerQuestions }),
            ...(arcade && { arcade })
          })
        )
        return log
      })
    this.queues.set(projectKey, next)
    return next
  }

  private nameOf(projectKey: string): string {
    return (
      this.names?.nameIn(this.dirOf(), '.json', projectKey) ??
      createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    )
  }

  private fileOf(projectKey: string): string {
    return join(this.dirOf(), `${this.nameOf(projectKey)}.json`)
  }

  /** A sibling the store never reads: what it set aside or backed up. */
  private besideOf(projectKey: string, suffix: string): string {
    return join(this.dirOf(), `${this.nameOf(projectKey)}.${suffix}.json`)
  }
}
