import { createHash } from 'node:crypto'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  mergeGameMemberSession,
  parseGameMemberSessionsFile,
  serializeGameMemberSessions,
  type GameMemberSession,
  type GameMemberSessionPatch,
  type GameMemberSessionsRead
} from '../../shared/orchestrator-game-member-sessions'

/** Each project's live members, one file per project, so a lead can resume them after a restart. */
export class GameMemberSessionStore {
  // Why per project: two writes to one file must not read the same old list and drop a member.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dirOf: () => string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async read(projectKey: string): Promise<GameMemberSessionsRead> {
    let text: string
    try {
      text = await readFile(this.fileOf(projectKey), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, members: [] }
      }
      return { ok: false, reason: `the saved members file cannot be read (${String(error)})` }
    }
    return parseGameMemberSessionsFile(text)
  }

  upsert(projectKey: string, patch: GameMemberSessionPatch): Promise<GameMemberSession[]> {
    return this.update(projectKey, (members) => mergeGameMemberSession(members, patch, this.now()))
  }

  remove(projectKey: string, tickets: readonly string[]): Promise<GameMemberSession[]> {
    const drop = new Set(tickets.map((ticket) => ticket.toUpperCase()))
    return this.update(projectKey, (members) =>
      members.some((one) => drop.has(one.ticket))
        ? members.filter((one) => !drop.has(one.ticket))
        : members
    )
  }

  /**
   * Moves a damaged file out of the way, bytes kept, and returns where it went; null when the file
   * is readable or missing. Only the person's discard calls this.
   */
  setAside(projectKey: string): Promise<string | null> {
    return this.queued(projectKey, async () => {
      const read = await this.read(projectKey)
      if (read.ok) {
        return null
      }
      // Why: going back to the newer Orca must find its file where it left it (game-data-migrations).
      if (read.newer) {
        throw new Error(`Left as it is: ${read.reason}. Update Orca to resume these members.`)
      }
      const file = this.fileOf(projectKey)
      const kept = file.replace(/\.json$/, `.unreadable-${Date.now()}.json`)
      await rename(file, kept)
      return kept
    })
  }

  /** `change` returns its input to leave the file as it is. */
  private update(
    projectKey: string,
    change: (members: GameMemberSession[]) => GameMemberSession[]
  ): Promise<GameMemberSession[]> {
    return this.queued(projectKey, async () => {
      const current = await this.read(projectKey)
      if (!current.ok) {
        throw new Error(`Members not saved: ${current.reason}`)
      }
      const next = change(current.members)
      if (next === current.members) {
        return current.members
      }
      await mkdir(this.dirOf(), { recursive: true })
      const file = this.fileOf(projectKey)
      // Why durable: this file exists for the crash or reboot that a plain rename can lose.
      await writeFileDurable(
        durableWriteTempPath(file),
        file,
        serializeGameMemberSessions(next, current.kept)
      )
      return next
    })
  }

  private queued<T>(projectKey: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectKey) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(run)
    this.queues.set(projectKey, next)
    return next
  }

  private fileOf(projectKey: string): string {
    const name = createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.members.json`)
  }
}
