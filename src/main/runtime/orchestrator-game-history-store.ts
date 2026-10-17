import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appendGameHistory,
  parseGameHistoryRecord,
  type GameHistoryRecord
} from '../../shared/orchestrator-game-history'

/** Each project's member history, one bounded JSON file per project on the Orca host. */
export class GameHistoryStore {
  // Why per project: two writes to one file must not read the same old list and drop a record.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly dirOf: () => string) {}

  async list(projectKey: string): Promise<GameHistoryRecord[]> {
    let text: string
    try {
      text = await readFile(this.fileOf(projectKey), 'utf8')
    } catch {
      return []
    }
    try {
      const parsed: unknown = JSON.parse(text)
      const records =
        typeof parsed === 'object' && parsed !== null && 'records' in parsed
          ? parsed.records
          : undefined
      return Array.isArray(records)
        ? records.flatMap((one) => parseGameHistoryRecord(one) ?? [])
        : []
    } catch {
      // Why: a damaged file must cost the history, never the stop or sweep that writes it.
      return []
    }
  }

  append(projectKey: string, record: GameHistoryRecord): Promise<GameHistoryRecord[]> {
    const previous = this.queues.get(projectKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const records = appendGameHistory(await this.list(projectKey), record)
        await mkdir(this.dirOf(), { recursive: true })
        const file = this.fileOf(projectKey)
        const temp = `${file}.${randomUUID()}.tmp`
        await writeFile(temp, JSON.stringify({ records }), 'utf8')
        // Why rename: a reader never sees a half-written file.
        await rename(temp, file)
        return records
      })
    this.queues.set(projectKey, next)
    return next
  }

  private fileOf(projectKey: string): string {
    const name = createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.json`)
  }
}
