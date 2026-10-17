import type { GameHistoryStore } from './orchestrator-game-history-store'
import type { GameStopSwitch } from './orchestrator-game-stop-switch'
import type { GameStop } from '../../shared/orchestrator-game-stop-state'
import {
  filterGameEvents,
  type GameEvent,
  type GameEventKind
} from '../../shared/orchestrator-game-events'

export type GameBoardCaller = { worktreeId?: string; terminalHandle?: string }

/** The project a caller belongs to: a member's is its lead's, so both write one board. */
export type GameBoardProject = {
  key: string
  /** A session a lead launched, which never leads. */
  isMember: boolean
  /** A member's ticket, from its task. */
  memberTicket: string | null
}

export type GameEventPost = GameBoardCaller & {
  kind: GameEventKind
  ticket?: string
  text?: string
  /** Kept once per project: what sweep and fleet observe on every run. */
  key?: string
}

/** A project's shared board on the Orca host: its events, read and written by lead and members. */
export class GameBoard {
  constructor(
    private readonly deps: {
      store: GameHistoryStore
      stops: GameStopSwitch
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      now?: () => Date
    }
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  async events(
    args: GameBoardCaller & { ticket?: string; since?: string }
  ): Promise<{ events: GameEvent[] }> {
    const project = await this.deps.projectOf(args)
    return { events: filterGameEvents(await this.deps.store.events(project.key), args) }
  }

  /** Every caller reads it, members too; one that cannot be read counts as set. */
  async stopState(caller: GameBoardCaller): Promise<{ stopped: GameStop | null }> {
    const project = await this.deps.projectOf(caller)
    return { stopped: await this.deps.stops.read(project.key) }
  }

  async setStop(caller: GameBoardCaller): Promise<{ stopped: GameStop; changed: boolean }> {
    const project = await this.leadProjectOf(caller, 'set')
    const result = await this.deps.stops.set(project.key, {
      since: this.now().toISOString(),
      by: 'lead'
    })
    if (result.changed) {
      await this.postEvent({ ...caller, kind: 'stopped', text: 'STOP set: no launches or pushes' })
    }
    return result
  }

  async clearStop(caller: GameBoardCaller): Promise<{ stopped: null; changed: boolean }> {
    const project = await this.leadProjectOf(caller, 'clear')
    const { changed } = await this.deps.stops.clear(project.key)
    if (changed) {
      await this.postEvent({ ...caller, kind: 'resumed', text: 'STOP cleared' })
    }
    return { stopped: null, changed }
  }

  // Why: STOP is the lead's switch; a stopped member must not be able to lift it.
  private async leadProjectOf(caller: GameBoardCaller, verb: string): Promise<GameBoardProject> {
    const project = await this.deps.projectOf(caller)
    if (project.isMember) {
      throw new Error(`Only the lead can ${verb} the project's STOP.`)
    }
    return project
  }

  async postEvent(args: GameEventPost): Promise<{ posted: boolean; event: GameEvent }> {
    const project = await this.deps.projectOf(args)
    // Why: a member always posts under its own ticket, so one cannot write another's line.
    const ticket = project.isMember
      ? project.memberTicket
      : (args.ticket?.trim().toUpperCase() ?? null)
    const event: GameEvent = {
      at: this.now().toISOString(),
      kind: args.kind,
      ticket: ticket || null,
      text: args.text?.trim() || null,
      by: project.isMember ? (project.memberTicket ?? 'member') : 'lead',
      ...(args.key ? { key: args.key } : {})
    }
    const { added } = await this.deps.store.appendEvent(project.key, event)
    return { posted: added, event }
  }
}
