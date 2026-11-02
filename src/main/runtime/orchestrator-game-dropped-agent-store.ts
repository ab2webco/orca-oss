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

/** The agents each project's lead dropped from its fleet, one file per project (ORCA-943). */
export class GameDroppedAgentStore {
  // Why per project: two writes to one file must not read the same old list and lose a drop.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dirOf: () => string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async read(projectKey: string): Promise<GameDroppedAgent[]> {
    try {
      return parseGameDroppedAgents(await readFile(this.fileOf(projectKey), 'utf8'))
    } catch {
      return []
    }
  }

  drop(projectKey: string, target: GameDropTarget, name: string): Promise<GameDroppedAgent[]> {
    return this.update(projectKey, (dropped) =>
      withDroppedGameAgent(dropped, { ...target, name, at: this.now() })
    )
  }

  restore(projectKey: string, target: GameDropTarget): Promise<GameDroppedAgent[]> {
    return this.update(projectKey, (dropped) => withoutDroppedGameAgent(dropped, target))
  }

  private update(
    projectKey: string,
    change: (dropped: GameDroppedAgent[]) => GameDroppedAgent[]
  ): Promise<GameDroppedAgent[]> {
    const previous = this.queues.get(projectKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const dropped = change(await this.read(projectKey))
        await mkdir(this.dirOf(), { recursive: true })
        const file = this.fileOf(projectKey)
        // Why durable: the drop must hold through the restart it exists for.
        await writeFileDurable(
          durableWriteTempPath(file),
          file,
          serializeGameDroppedAgents(dropped)
        )
        return dropped
      })
    this.queues.set(projectKey, next)
    return next
  }

  private fileOf(projectKey: string): string {
    const name = createHash('sha256').update(projectKey).digest('hex').slice(0, 32)
    return join(this.dirOf(), `${name}.dropped.json`)
  }
}
