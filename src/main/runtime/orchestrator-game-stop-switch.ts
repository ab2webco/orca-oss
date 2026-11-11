import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  UNREADABLE_GAME_STOP,
  parseGameStop,
  type GameStop
} from '../../shared/orchestrator-game-stop-state'
import type { GameStoreNaming } from './orchestrator-game-store-names'

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const legacyNameOf = (projectKey: string): string =>
  createHash('sha256').update(projectKey).digest('hex').slice(0, 32)

async function removeIfPresent(file: string): Promise<boolean> {
  try {
    await unlink(file)
    return true
  } catch (error) {
    if (isMissing(error)) {
      return false
    }
    throw error
  }
}

/**
 * Each project's STOP, one file per project on the Orca host that runs the lead.
 * Why a file of its own: STOP fails closed, so a damaged history must never read as STOP.
 */
export class GameStopSwitch {
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dirOf: () => string,
    private readonly names?: GameStoreNaming
  ) {}

  /** Null only when no STOP file exists; one that cannot be read counts as set. */
  async read(projectKey: string): Promise<GameStop | null> {
    let text: string
    try {
      text = await readFile(this.fileOf(projectKey), 'utf8')
    } catch (error) {
      return isMissing(error) ? null : UNREADABLE_GAME_STOP
    }
    try {
      return parseGameStop(JSON.parse(text))
    } catch {
      return UNREADABLE_GAME_STOP
    }
  }

  /** Keeps the first since when set again. */
  set(
    projectKey: string,
    stop: { since: string; by: string }
  ): Promise<{ stopped: GameStop; changed: boolean }> {
    return this.queued(projectKey, async () => {
      const current = await this.read(projectKey)
      if (current && !current.unreadable) {
        return { stopped: current, changed: false }
      }
      await mkdir(this.dirOf(), { recursive: true })
      const file = this.fileOf(projectKey)
      const temp = `${file}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(stop), 'utf8')
      await rename(temp, file)
      return { stopped: { since: stop.since, by: stop.by }, changed: true }
    })
  }

  /** Throws when a file cannot be removed, so the caller reports STOP as still set. */
  clear(projectKey: string): Promise<{ changed: boolean }> {
    return this.queued(projectKey, async () => {
      const file = this.fileOf(projectKey)
      // Why the repo id's file too: the ORCA-1011 naming copies it back after a restart (ORCA-1157).
      const legacy = join(this.dirOf(), `${legacyNameOf(projectKey)}.stop.json`)
      const removed = await Promise.all([...new Set([file, legacy])].map(removeIfPresent))
      return { changed: removed.some(Boolean) }
    })
  }

  /** Carries another key's STOP to this key, that file then set aside; null when it has none. */
  async adopt(fromKey: string, toKey: string): Promise<GameStop | null> {
    const stop = await this.read(fromKey)
    if (!stop) {
      return null
    }
    // Why: STOP fails closed, so one that cannot be read must stay where the person can see it.
    if (stop.unreadable || !stop.since) {
      throw new Error(`The STOP under ${fromKey} cannot be read; it was left as it is.`)
    }
    await this.set(toKey, { since: stop.since, by: stop.by ?? 'lead' })
    const file = this.fileOf(fromKey)
    await rename(file, file.replace(/\.stop\.json$/, `.adopted-${Date.now()}.stop-was.json`))
    return stop
  }

  private queued<T>(projectKey: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectKey) ?? Promise.resolve())
      .catch(() => undefined)
      .then(work)
    this.queues.set(projectKey, next)
    return next
  }

  private fileOf(projectKey: string): string {
    const name =
      this.names?.nameIn(this.dirOf(), '.stop.json', projectKey) ?? legacyNameOf(projectKey)
    return join(this.dirOf(), `${name}.stop.json`)
  }
}
