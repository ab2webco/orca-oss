import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  parseGameDroppedAgents,
  serializeGameDroppedAgents,
  withDroppedGameAgent,
  withoutDroppedGameAgent,
  type GameDropTarget,
  type GameDroppedAgent
} from '../../shared/orchestrator-game-dropped-agents'
import {
  parseGameForgottenAgents,
  withForgottenGameAgent,
  type GameForgottenAgent
} from '../../shared/orchestrator-game-forgotten-agents'
import type { GameStoreNaming } from './orchestrator-game-store-names'

type GameFleetHides = { dropped: GameDroppedAgent[]; forgotten: GameForgottenAgent[] }

/** The agents each project's lead dropped or removed from its fleet, one file per project (ORCA-943). */
export class GameDroppedAgentStore {
  // Why per project: two writes to one file must not read the same old list and lose a drop.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dirOf: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly names?: GameStoreNaming
  ) {}

  async read(projectKey: string): Promise<GameDroppedAgent[]> {
    return (await this.readAll(projectKey)).dropped
  }

  async readAll(projectKey: string): Promise<GameFleetHides> {
    try {
      const text = await readFile(this.fileOf(projectKey), 'utf8')
      return { dropped: parseGameDroppedAgents(text), forgotten: parseGameForgottenAgents(text) }
    } catch {
      return { dropped: [], forgotten: [] }
    }
  }

  set(
    projectKey: string,
    target: GameDropTarget & { name: string },
    drop: boolean
  ): Promise<GameDroppedAgent[]> {
    return this.update(projectKey, ({ dropped, forgotten }) => ({
      dropped: drop
        ? withDroppedGameAgent(dropped, { ...target, at: this.now() })
        : withoutDroppedGameAgent(dropped, target),
      forgotten
    })).then((hides) => hides.dropped)
  }

  forget(
    projectKey: string,
    member: Pick<GameForgottenAgent, 'paneKey' | 'name'>
  ): Promise<GameForgottenAgent[]> {
    return this.update(projectKey, ({ dropped, forgotten }) => ({
      dropped,
      forgotten: withForgottenGameAgent(forgotten, { ...member, forgottenAt: this.now() })
    })).then((hides) => hides.forgotten)
  }

  /**
   * Forgets the drops of this machine's removed worktrees, so a new one at the same path is listed;
   * `all` empties the project, as for a removed repo. Returns how many entries went (ORCA-1478).
   */
  async forgetWorktrees(
    projectKey: string,
    removed: (worktreeId: string) => boolean,
    all = false
  ): Promise<number> {
    let count = 0
    await this.update(projectKey, (hides) => {
      const dropped = all
        ? []
        : hides.dropped.filter((one) => one.environmentId !== null || !removed(one.worktreeId))
      const forgotten = all ? [] : hides.forgotten
      count = hides.dropped.length - dropped.length + hides.forgotten.length - forgotten.length
      return count > 0 ? { dropped, forgotten } : hides
    })
    return count
  }

  private update(
    projectKey: string,
    change: (hides: GameFleetHides) => GameFleetHides
  ): Promise<GameFleetHides> {
    const previous = this.queues.get(projectKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.readAll(projectKey)
        const hides = change(current)
        // Why: a change that keeps the list must not create a file for a project with none.
        if (hides === current) {
          return hides
        }
        await mkdir(this.dirOf(), { recursive: true })
        const file = this.fileOf(projectKey)
        // Why durable: the drop must hold through the restart it exists for.
        await writeFileDurable(
          durableWriteTempPath(file),
          file,
          serializeGameDroppedAgents(hides.dropped, hides.forgotten)
        )
        return hides
      })
    this.queues.set(projectKey, next)
    return next
  }

  private fileOf(projectKey: string): string {
    const name =
      this.names?.nameIn(this.dirOf(), '.dropped.json', projectKey) ??
      createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.dropped.json`)
  }
}
