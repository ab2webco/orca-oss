import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import { GameLeadDirectory } from './orchestrator-game-lead-directory'
import type { GameLeadRecord } from './orchestrator-game-lead-roster'

export type GameLeadListing = { project: string; label: string; handle: string; since: string }

/** What reopens a project's lead conversation once its pane is gone; `accountId` is the managed account it ran on. */
export type GameLeadSession = {
  sessionId: string
  agentArgs: string | null
  worktreeId: string
  accountId: string | null
}

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
  /** What the roster keeps, by project; `pending` are the ones a restart has not matched to a pane yet. */
  private readonly records = new Map<string, GameLeadRecord>()
  private readonly pending = new Map<string, GameLeadRecord>()
  private loaded: Promise<void> | null = null

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
        clear: (projectKey: string) => Promise<void>
      }
      sessionOf?: (handle: string) => Promise<GameLeadSession | null>
      /** Reopens the conversation in a new pane and returns that pane's handle. */
      resume?: (session: GameLeadSession) => Promise<string>
      focus?: (handle: string) => Promise<void>
      roster?: {
        read: () => Promise<GameLeadRecord[]>
        write: (records: GameLeadRecord[]) => Promise<void>
      }
      paneOf?: (handle: string) => string | null
      /** The handle of a pane whose terminal is connected now; null until the pane is back. */
      handleOfPane?: (paneKey: string) => string | null
      /** `starting` is anything that is neither Claude nor a shell, and an unreadable pane. */
      paneState?: (handle: string) => Promise<'running' | 'shell' | 'starting'>
    }
  ) {}

  /**
   * A member never leads; `registered: false` is a quiet no for it and for a caller Orca cannot place.
   * With `claim`, the project keeps one live lead and a closed lead's conversation reopens; `fresh`
   * retires that conversation instead, so the caller becomes the new lead.
   */
  async register(
    args: GameBoardCaller & { project: string; label: string; claim?: boolean; fresh?: boolean }
  ): Promise<GameLeadRegistration> {
    const project = await this.deps.projectOf(args)
    if (project.isMember || !project.lead) {
      return { registered: false }
    }
    const caller = project.lead.handle
    const callerPane = project.lead.paneKey
    const entryOf = (handle: string) => ({
      projectKey: project.key,
      project: args.project,
      handle,
      label: args.label,
      at: (this.deps.now?.() ?? new Date()).toISOString()
    })
    if (!args.claim || project.key === UNPLACED_PROJECT) {
      const entry = entryOf(caller)
      this.directory.register(entry)
      if (project.key !== UNPLACED_PROJECT) {
        const mine = (await this.deps.sessionOf?.(caller).catch(() => null)) ?? null
        await this.remember(entry, callerPane, mine)
      }
      return { registered: true }
    }
    return this.queued(project.key, async () => {
      await this.settle(project.key)
      const live = await this.leadOf(project.key)
      if (live && live.handle !== caller) {
        await this.deps.focus?.(live.handle).catch(() => undefined)
        return { registered: false, live: { handle: live.handle } }
      }
      const mine = (await this.deps.sessionOf?.(caller).catch(() => null)) ?? null
      let resumeError: string | undefined
      const stored =
        live || args.fresh ? null : await this.deps.sessions?.read(project.key).catch(() => null)
      if (stored && stored.sessionId !== mine?.sessionId && this.deps.resume) {
        try {
          const handle = await this.deps.resume(stored)
          const entry = entryOf(handle)
          this.directory.register(entry)
          await this.remember(entry, this.deps.paneOf?.(handle) ?? null, stored)
          return { registered: false, resumed: { handle } }
        } catch (error) {
          resumeError = error instanceof Error ? error.message : String(error)
        }
      }
      const entry = entryOf(caller)
      this.directory.register(entry)
      await this.remember(entry, callerPane, mine)
      if (mine) {
        await this.deps.sessions?.write(project.key, mine).catch(() => undefined)
      } else if (args.fresh) {
        await this.deps.sessions?.clear(project.key).catch(() => undefined)
      }
      return { registered: true, ...(resumeError === undefined ? {} : { resumeError }) }
    })
  }

  private async leadOf(projectKey: string): Promise<{ handle: string } | null> {
    const live = this.directory.leadOf(projectKey, this.deps.isLive)
    return live && (await this.isRunning(live.handle)) ? live : null
  }

  private async isRunning(handle: string): Promise<boolean> {
    return !this.deps.isRunning || (await this.deps.isRunning(handle).catch(() => true))
  }

  /** The project's live lead when it is not the caller, so a second pane does not start one. */
  async leadElsewhere(caller: GameBoardCaller): Promise<string | null> {
    const project = await this.deps.projectOf(caller)
    if (project.isMember || !project.lead || project.key === UNPLACED_PROJECT) {
      return null
    }
    await this.settle(project.key)
    const live = await this.leadOf(project.key)
    return live && live.handle !== project.lead.handle ? live.handle : null
  }

  /** The project's live lead, for a caller that is no terminal: the person's Inbox. */
  async liveLeadOf(projectKey: string): Promise<string | null> {
    await this.settle(projectKey)
    return (await this.leadOf(projectKey))?.handle ?? null
  }

  async list(): Promise<{ leads: GameLeadListing[] }> {
    await this.settle()
    const live = this.directory.live(this.deps.isLive)
    const running = await Promise.all(live.map((one) => this.isRunning(one.handle)))
    return {
      leads: live
        .filter((_, index) => running[index])
        .map((one) => ({
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

  private async remember(
    entry: { projectKey: string; project: string; label: string; at: string },
    paneKey: string | null,
    session: GameLeadSession | null
  ): Promise<void> {
    await this.load()
    this.pending.delete(entry.projectKey)
    this.records.delete(entry.projectKey)
    // Why: one project per pane, as the directory keeps one per terminal.
    for (const [key, one] of this.records) {
      if (one.paneKey === paneKey) {
        this.records.delete(key)
        this.pending.delete(key)
      }
    }
    if (paneKey) {
      const { projectKey, project, label, at } = entry
      const sessionId = session?.sessionId ?? null
      this.records.set(projectKey, { projectKey, project, paneKey, label, at, sessionId })
    }
    await this.persist()
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const kept = (await this.deps.roster?.read().catch(() => [])) ?? []
      for (const one of kept) {
        if (one.projectKey !== UNPLACED_PROJECT) {
          this.records.set(one.projectKey, one)
          this.pending.set(one.projectKey, one)
        }
      }
    })()
    return this.loaded
  }

  /**
   * Matches leads kept from before a restart to the pane each now answers to. Why on every read: panes
   * come back only after the renderer and the daemon reattach, and an SSH pane later still.
   */
  private async settle(projectKey?: string): Promise<void> {
    await this.load()
    let forgot = false
    for (const one of this.pending.values()) {
      if (projectKey !== undefined && one.projectKey !== projectKey) {
        continue
      }
      const verdict = await this.restore(one)
      if (verdict === 'wait' || this.pending.get(one.projectKey) !== one) {
        continue
      }
      this.pending.delete(one.projectKey)
      if (verdict === 'forget') {
        this.records.delete(one.projectKey)
        forgot = true
      }
    }
    if (forgot) {
      await this.persist()
    }
  }

  // Why proof and not liveness: a restored lead must be the conversation that ran `game lead` (ORCA-613).
  private async restore(one: GameLeadRecord): Promise<'restored' | 'forget' | 'wait'> {
    const handle = this.deps.handleOfPane?.(one.paneKey) ?? null
    if (!handle || !this.deps.isLive(handle) || !this.deps.paneState) {
      return 'wait'
    }
    // Why the shell first: a pane back at its shell can still report the conversation it last ran.
    const state = await this.deps.paneState(handle).catch(() => 'starting' as const)
    if (state === 'shell') {
      return 'forget'
    }
    const session = (await this.deps.sessionOf?.(handle).catch(() => null)) ?? null
    if (one.sessionId !== null && session !== null) {
      if (session.sessionId !== one.sessionId) {
        return 'forget'
      }
    } else if (state !== 'running') {
      return 'wait'
    }
    if (this.pending.get(one.projectKey) !== one) {
      return 'wait'
    }
    const { projectKey, project, label, at } = one
    this.directory.register({ projectKey, project, handle, label, at })
    return 'restored'
  }

  private async persist(): Promise<void> {
    await this.deps.roster?.write([...this.records.values()]).catch(() => undefined)
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
