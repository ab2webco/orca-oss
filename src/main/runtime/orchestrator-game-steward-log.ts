import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  GAME_STEWARD_TICKET,
  parseGameStewardDecision,
  type GameMemberSteward,
  type GameStewardDecision
} from '../../shared/orchestrator-game-member-steward'
import type { GameStoreNaming } from './orchestrator-game-store-names'

/** One line of a ticket's durable steward log: a decision and the session that made it. */
export type GameStewardLogEntry = GameStewardDecision & { session: string | null }

const keyOf = (entry: { session: string | null; at: number; moment: string }): string =>
  `${entry.session ?? ''}\0${entry.at}\0${entry.moment}`

function entriesOf(text: string): GameStewardLogEntry[] {
  return text.split('\n').flatMap((line) => {
    try {
      const raw = JSON.parse(line) as { session?: unknown }
      const decision = parseGameStewardDecision(raw)
      const session = typeof raw.session === 'string' ? raw.session : null
      return decision ? [{ ...decision, session }] : []
    } catch {
      return []
    }
  })
}

/**
 * Each ticket's steward decisions, one JSONL file per project and ticket (ORCA-1242). Appended,
 * never rewritten: a pane re-sends its latest decisions on every poll, so lines already kept are skipped.
 */
export class GameStewardLog {
  // Why per file: two polls must not both read the old file and append the same line.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dirOf: () => string,
    private readonly names?: GameStoreNaming
  ) {}

  /** How many lines it appended; none for a ticket that is not a safe file name part. */
  async append(
    projectKey: string,
    { ticket, session, decisions }: Pick<GameMemberSteward, 'ticket' | 'session' | 'decisions'>
  ): Promise<number> {
    if (!ticket || !GAME_STEWARD_TICKET.test(ticket)) {
      return 0
    }
    const file = this.fileOf(projectKey, ticket)
    return this.queued(file, async () => {
      const kept = new Set(entriesOf(await readText(file)).map(keyOf))
      const fresh = decisions.filter((one) => !kept.has(keyOf({ ...one, session })))
      if (fresh.length > 0) {
        await mkdir(this.dirOf(), { recursive: true })
        const lines = fresh.map((one) => `${JSON.stringify({ session, ...one })}\n`)
        await appendFile(file, lines.join(''), 'utf8')
      }
      return fresh.length
    })
  }

  read(projectKey: string, ticket: string): Promise<GameStewardLogEntry[]> {
    const file = this.fileOf(projectKey, ticket)
    return this.queued(file, async () => entriesOf(await readText(file)))
  }

  private queued<T>(file: string, run: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(run)
    this.queues.set(file, next)
    return next
  }

  // Why the ticket in the name is safe: append holds it to [A-Za-z0-9_-].
  private fileOf(projectKey: string, ticket: string): string {
    const suffix = `.${ticket.toUpperCase()}.steward.jsonl`
    const name =
      this.names?.nameIn(this.dirOf(), suffix, projectKey) ??
      createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}${suffix}`)
  }
}

async function readText(file: string): Promise<string> {
  return readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })
}
