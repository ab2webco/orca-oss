import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameLeadSession } from './orchestrator-game-leads'

const sessionOf = (value: unknown): GameLeadSession | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { sessionId, agentArgs, worktreeId } = value as Record<string, unknown>
  return typeof sessionId === 'string' &&
    sessionId !== '' &&
    typeof worktreeId === 'string' &&
    (agentArgs === null || typeof agentArgs === 'string')
    ? { sessionId, agentArgs, worktreeId }
    : null
}

const TEAMMATE_MODE = /(?:^|\s)--teammate-mode(?:=|\s+)(auto|in-process)(?=\s|$)/

/**
 * The args that reopen a lead with its game. Why the teammate mode: a `--resume` launch without one
 * starts as plain Claude, and the game only loads into an Agent Teams pane.
 */
export const leadResumeArgsOf = (
  launch: { agentCommand?: string; agentArgs: string } | null
): string | null => {
  const args = launch?.agentArgs.trim() ?? ''
  const mode = TEAMMATE_MODE.exec(launch?.agentCommand ?? '')?.[1]
  const resumeArgs = mode && !TEAMMATE_MODE.test(args) ? `--teammate-mode ${mode} ${args}` : args
  return resumeArgs.trim() || null
}

/** Each project's last lead conversation, one file per project, so it survives a restart of Orca. */
export class GameLeadSessions {
  constructor(private readonly dirOf: () => string) {}

  /** Null for a missing or damaged record: the caller then starts a new lead. */
  async read(projectKey: string): Promise<GameLeadSession | null> {
    try {
      return sessionOf(JSON.parse(await readFile(this.fileOf(projectKey), 'utf8')))
    } catch {
      return null
    }
  }

  async write(projectKey: string, session: GameLeadSession): Promise<void> {
    await mkdir(this.dirOf(), { recursive: true })
    const file = this.fileOf(projectKey)
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(session), 'utf8')
    await rename(temp, file)
  }

  private fileOf(projectKey: string): string {
    const name = createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.lead.json`)
  }
}
