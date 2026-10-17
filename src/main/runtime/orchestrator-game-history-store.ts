import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

type ProjectLog = {
  records: GameHistoryRecord[]
  events: GameEvent[]
  /** Per inbox (`lead` or a ticket), the newest orchestration message sequence the board marked read. */
  cursors: Record<string, number>
}

// Why bounded: one cursor per ticket ever launched would grow without end.
const CURSORS_MAX = 200

function cursorsOf(parsed: unknown): Record<string, number> {
  const raw =
    typeof parsed === 'object' && parsed !== null && 'cursors' in parsed ? parsed.cursors : null
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, number] =>
        entry[0].length <= 40 && typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )
  )
}

const listOf = <T>(parsed: unknown, key: string, parse: (raw: unknown) => T | null): T[] => {
  const list =
    typeof parsed === 'object' && parsed !== null && key in parsed
      ? (parsed as Record<string, unknown>)[key]
      : undefined
  return Array.isArray(list) ? list.flatMap((one) => parse(one) ?? []) : []
}

/** Each project's member history and event record, one bounded JSON file per project on the Orca host. */
export class GameHistoryStore {
  // Why per project: two writes to one file must not read the same old list and drop a record.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly dirOf: () => string) {}

  async list(projectKey: string): Promise<GameHistoryRecord[]> {
    return (await this.read(projectKey)).records
  }

  async events(projectKey: string): Promise<GameEvent[]> {
    return (await this.read(projectKey)).events
  }

  async cursors(projectKey: string): Promise<Record<string, number>> {
    return (await this.read(projectKey)).cursors
  }

  /** Moves an inbox's read cursor forward, never back. */
  async markInboxRead(projectKey: string, inbox: string, sequence: number): Promise<void> {
    await this.update(projectKey, (current) => {
      if ((current.cursors[inbox] ?? 0) >= sequence) {
        return null
      }
      const { [inbox]: _old, ...others } = current.cursors
      const kept = Object.entries(others).slice(-(CURSORS_MAX - 1))
      return { ...current, cursors: { ...Object.fromEntries(kept), [inbox]: sequence } }
    })
  }

  async append(projectKey: string, record: GameHistoryRecord): Promise<GameHistoryRecord[]> {
    const log = await this.update(projectKey, (current) => ({
      ...current,
      records: appendGameHistory(current.records, record)
    }))
    return log.records
  }

  /** `added` is false when an event with the same key is already kept. */
  async appendEvent(projectKey: string, event: GameEvent): Promise<{ added: boolean }> {
    let added = false
    await this.update(projectKey, (current) => {
      const next = appendGameEvent(current.events, event)
      added = next.added
      return next.added ? { ...current, events: next.events } : null
    })
    return { added }
  }

  private async read(projectKey: string): Promise<ProjectLog> {
    let text: string
    try {
      text = await readFile(this.fileOf(projectKey), 'utf8')
    } catch {
      return { records: [], events: [], cursors: {} }
    }
    try {
      const parsed: unknown = JSON.parse(text)
      return {
        records: listOf(parsed, 'records', parseGameHistoryRecord),
        events: listOf(parsed, 'events', parseGameEvent),
        cursors: cursorsOf(parsed)
      }
    } catch {
      // Why: a damaged file must cost the history, never the stop or sweep that writes it.
      return { records: [], events: [], cursors: {} }
    }
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
        const current = await this.read(projectKey)
        const log = change(current)
        if (!log) {
          return current
        }
        await mkdir(this.dirOf(), { recursive: true })
        const file = this.fileOf(projectKey)
        const temp = `${file}.${randomUUID()}.tmp`
        await writeFile(temp, JSON.stringify(log), 'utf8')
        // Why rename: a reader never sees a half-written file.
        await rename(temp, file)
        return log
      })
    this.queues.set(projectKey, next)
    return next
  }

  private fileOf(projectKey: string): string {
    const name = createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.json`)
  }
}
