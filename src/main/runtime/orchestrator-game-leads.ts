import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import { GameLeadDirectory } from './orchestrator-game-lead-directory'

export type GameLeadListing = { project: string; label: string; handle: string; since: string }

/** The leads of this Orca host: `orca game lead` registers one, `orca game leads` lists the live ones. */
export class GameLeads {
  private readonly directory = new GameLeadDirectory()

  constructor(
    private readonly deps: {
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      isLive: (handle: string) => boolean
      now?: () => Date
    }
  ) {}

  /** A member never leads; `registered: false` is a quiet no for it and for a caller Orca cannot place. */
  async register(
    args: GameBoardCaller & { project: string; label: string }
  ): Promise<{ registered: boolean }> {
    const project = await this.deps.projectOf(args)
    if (project.isMember || !project.lead) {
      return { registered: false }
    }
    this.directory.register({
      projectKey: project.key,
      project: args.project,
      handle: project.lead.handle,
      label: args.label,
      at: (this.deps.now?.() ?? new Date()).toISOString()
    })
    return { registered: true }
  }

  list(): { leads: GameLeadListing[] } {
    return {
      leads: this.directory.live(this.deps.isLive).map((one) => ({
        project: one.project,
        label: one.label,
        handle: one.handle,
        since: one.at
      }))
    }
  }

  /** Lead handle to label, for naming a peer lead in an inbox. */
  labels(): Record<string, string> {
    return this.directory.labelsOf(this.deps.isLive)
  }
}
