import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import { GameLeadDirectory } from './orchestrator-game-lead-directory'

export type GameLeadListing = { project: string; label: string; handle: string; since: string }

/** What reopens a project's lead conversation once its pane is gone. */
export type GameLeadSession = { sessionId: string; agentArgs: string | null; worktreeId: string }

/** `registered: false` with `live` or `resumed` names the pane that is the lead instead of the caller. */
export type GameLeadRegistration = {
  registered: boolean
  live?: { handle: string }
  resumed?: { handle: string }
  /** Why the stored conversation did not reopen, so the caller became a new lead. */
  resumeError?: string
}

// Why: an unplaced caller shares this key with every other, so one lead there is not one per project.
const UNPLACED_PROJECT = 'no-project'

/** The leads of this Orca host: `orca game lead` registers one, `orca game leads` lists the live ones. */
export class GameLeads {
  private readonly directory = new GameLeadDirectory()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly deps: {
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      isLive: (handle: string) => boolean
      /** False once the pane is back at its shell: a lead that ran /exit, or a resume Claude refused. */
      isRunning?: (handle: string) => Promise<boolean>
      now?: () => Date
      sessions?: {
        read: (projectKey: string) => Promise<GameLeadSession | null>
        write: (projectKey: string, session: GameLeadSession) => Promise<void>
      }
      sessionOf?: (handle: string) => Promise<GameLeadSession | null>
      /** Reopens the conversation in a new pane and returns that pane's handle. */
      resume?: (session: GameLeadSession) => Promise<string>
      focus?: (handle: string) => Promise<void>
    }
  ) {}

  /**
   * A member never leads; `registered: false` is a quiet no for it and for a caller Orca cannot place.
   * With `claim`, the project keeps one live lead and a closed lead's conversation reopens.
   */
  async register(
    args: GameBoardCaller & { project: string; label: string; claim?: boolean }
  ): Promise<GameLeadRegistration> {
    const project = await this.deps.projectOf(args)
    if (project.isMember || !project.lead) {
      return { registered: false }
    }
    const caller = project.lead.handle
    const entryOf = (handle: string) => ({
      projectKey: project.key,
      project: args.project,
      handle,
      label: args.label,
      at: (this.deps.now?.() ?? new Date()).toISOString()
    })
    if (!args.claim || project.key === UNPLACED_PROJECT) {
      this.directory.register(entryOf(caller))
      return { registered: true }
    }
    return this.queued(project.key, async () => {
      const live = await this.leadOf(project.key)
      if (live && live.handle !== caller) {
        await this.deps.focus?.(live.handle).catch(() => undefined)
        return { registered: false, live: { handle: live.handle } }
      }
      const mine = (await this.deps.sessionOf?.(caller).catch(() => null)) ?? null
      let resumeError: string | undefined
      const stored = live ? null : await this.deps.sessions?.read(project.key).catch(() => null)
      if (stored && stored.sessionId !== mine?.sessionId && this.deps.resume) {
        try {
          const handle = await this.deps.resume(stored)
          this.directory.register(entryOf(handle))
          return { registered: false, resumed: { handle } }
        } catch (error) {
          resumeError = error instanceof Error ? error.message : String(error)
        }
      }
      this.directory.register(entryOf(caller))
      if (mine) {
        await this.deps.sessions?.write(project.key, mine).catch(() => undefined)
      }
      return { registered: true, ...(resumeError === undefined ? {} : { resumeError }) }
    })
  }

  private async leadOf(projectKey: string): Promise<{ handle: string } | null> {
    const live = this.directory.leadOf(projectKey, this.deps.isLive)
    if (!live || !this.deps.isRunning) {
      return live
    }
    return (await this.deps.isRunning(live.handle).catch(() => true)) ? live : null
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

  // Why per project: two panes claiming at once would otherwise both resume the closed lead.
  private queued<T>(projectKey: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(projectKey) ?? Promise.resolve())
      .catch(() => undefined)
      .then(work)
    this.queues.set(projectKey, next)
    return next
  }
}
