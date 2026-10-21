import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A registered lead as kept on disk. Why the pane key: terminal handles are minted anew each launch. */
export type GameLeadRecord = {
  projectKey: string
  project: string
  paneKey: string
  label: string
  at: string
  /** The lead's conversation when registered, so a restart never adopts another one in that pane. */
  sessionId: string | null
}

const VERSION = 1

const recordOf = (value: unknown): GameLeadRecord | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { projectKey, project, paneKey, label, at, sessionId } = value as Record<string, unknown>
  return typeof projectKey === 'string' &&
    typeof project === 'string' &&
    typeof paneKey === 'string' &&
    paneKey !== '' &&
    typeof label === 'string' &&
    typeof at === 'string' &&
    (sessionId === null || typeof sessionId === 'string')
    ? { projectKey, project, paneKey, label, at, sessionId }
    : null
}

/** The leads this host registered, in one file, so a lead whose pane survives a restart is listed again. */
export class GameLeadRoster {
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly dirOf: () => string) {}

  /** Empty for a missing, damaged or other-version file: the leads then register again by hand. */
  async read(): Promise<GameLeadRecord[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file(), 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) {
        return []
      }
      const { version, leads } = parsed as Record<string, unknown>
      if (version !== VERSION || !Array.isArray(leads)) {
        return []
      }
      return leads.map(recordOf).filter((one): one is GameLeadRecord => one !== null)
    } catch {
      return []
    }
  }

  // Why chained: two registrations write at once, and the later snapshot must land last.
  write(records: GameLeadRecord[]): Promise<void> {
    const next = this.writes.catch(() => undefined).then(() => this.replace(records))
    this.writes = next
    return next
  }

  private async replace(records: GameLeadRecord[]): Promise<void> {
    await mkdir(this.dirOf(), { recursive: true })
    const file = this.file()
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify({ version: VERSION, leads: records }), 'utf8')
    await rename(temp, file)
  }

  private file(): string {
    return join(this.dirOf(), 'live-leads.json')
  }
}
