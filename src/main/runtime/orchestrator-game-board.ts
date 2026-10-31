import { randomUUID } from 'node:crypto'
import type { GameHistoryStore } from './orchestrator-game-history-store'
import type { GameStopSwitch } from './orchestrator-game-stop-switch'
import type { GameStop } from '../../shared/orchestrator-game-stop-state'
import {
  gameInboxesOf,
  type GameInbox,
  type GameInboxSource,
  type GameInboxSummary
} from '../../shared/orchestrator-game-inbox'
import {
  gameInboxThreadsOf,
  type GameInboxThreads
} from '../../shared/orchestrator-game-inbox-threads'
import {
  ownerMemberReplyNote,
  type OwnerMemberReply,
  type OwnerMemberReplyMode
} from './orchestrator-game-owner-member-reply'
import {
  filterGameEvents,
  gameMergesOf,
  type GameEvent,
  type GameEventKind,
  type GameEventMerge,
  type GameMerge
} from '../../shared/orchestrator-game-events'
import {
  addGameOwnerQuestion,
  answerGameOwnerQuestion,
  gameOwnerAnswerNote,
  gameOwnerQuestionDraftOf,
  openGameOwnerQuestions,
  parseGameOwnerQuestion,
  type GameOwnerQuestion,
  type GameOwnerQuestionDraft,
  type GameOwnerReply
} from '../../shared/orchestrator-game-owner-questions'

export type GameBoardCaller = { worktreeId?: string; terminalHandle?: string }

/** The project a caller belongs to: a member's is its lead's, so both write one board. */
export type GameBoardProject = {
  key: string
  /** A session a lead launched, which never leads. */
  isMember: boolean
  /** A member's ticket, from its task. */
  memberTicket: string | null
  /** The lead's terminal, whose run holds the project's mail; null when Orca cannot tell. */
  lead: GameBoardLead | null
}

export type GameBoardLead = { handle: string; paneKey: string | null }

/** The person's Inbox calls with a worktree, never a terminal: its lead is the project's live one. */
export async function withProjectLead(
  project: GameBoardProject,
  liveLeadOf: (projectKey: string) => Promise<string | null>,
  paneOf: (handle: string) => string | null
): Promise<GameBoardProject> {
  if (project.lead || project.isMember) {
    return project
  }
  const handle = await liveLeadOf(project.key)
  return handle ? { ...project, lead: { handle, paneKey: paneOf(handle) } } : project
}

/** Mail the host sends the lead itself; tellLead returns false when it could not be stored. */
export type GameLeadNote = { subject: string; body: string; payload: Record<string, unknown> }

// Why 20: the lead's and the recent tickets'; game state stays small on every poll.
const INBOX_SUMMARY_MAX = 20
// Why 20: more merges than a project lands between two of the lead's polls.
const MERGES_MAX = 20

export type GameEventPost = GameBoardCaller & {
  kind: GameEventKind
  ticket?: string
  text?: string
  /** Kept once per project: what sweep and fleet observe on every run. */
  key?: string
  merge?: GameEventMerge
}

/** A project's shared board on the Orca host: its events, read and written by lead and members. */
export class GameBoard {
  constructor(
    private readonly deps: {
      store: GameHistoryStore
      stops: GameStopSwitch
      projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
      inboxSourceOf: (lead: GameBoardLead) => GameInboxSource
      tellLead: (lead: GameBoardLead, note: GameLeadNote) => boolean
      /** Lets an open Inbox refresh instead of polling. */
      ownerQuestionsChanged?: (projectKey: string) => void
      /** Sends the person's words to a member through the lead's run; throws why it could not. */
      replyToMember?: (lead: GameBoardLead, args: { id: string; text: string }) => OwnerMemberReply
      now?: () => Date
    }
  ) {}

  /** The person answers or overrides for a member from the Inbox; the lead hears it once, to record it on the ticket. */
  async replyToMember(
    args: GameBoardCaller & { id: string; text: string; ticket?: string }
  ): Promise<{ mode: OwnerMemberReplyMode; delivered: boolean }> {
    const project = await this.deps.projectOf(args)
    if (project.isMember) {
      throw new Error('A member answers its lead, never another member for the person.')
    }
    if (!project.lead || !this.deps.replyToMember) {
      throw new Error('This project has no live lead to answer its members through.')
    }
    const reply = this.deps.replyToMember(project.lead, { id: args.id, text: args.text })
    const ticket = args.ticket?.trim().toUpperCase() || null
    const delivered = this.deps.tellLead(
      project.lead,
      ownerMemberReplyNote({ id: args.id, ticket, text: args.text, reply })
    )
    return { mode: reply.mode, delivered }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  async events(
    args: GameBoardCaller & { ticket?: string; since?: string }
  ): Promise<{ events: GameEvent[] }> {
    const project = await this.deps.projectOf(args)
    return { events: filterGameEvents(await this.deps.store.events(project.key), args) }
  }

  /** The members' latest recorded merges, for the lead's rewards. */
  async merges(caller: GameBoardCaller): Promise<GameMerge[]> {
    const project = await this.deps.projectOf(caller)
    return project.isMember
      ? []
      : gameMergesOf(await this.deps.store.events(project.key), MERGES_MAX)
  }

  /** A member reads only its own ticket's inbox; the lead its own, or a ticket's with `ticket`. */
  async inbox(
    args: GameBoardCaller & { ticket?: string; unread?: boolean; markRead?: boolean }
  ): Promise<{ inbox: GameInbox }> {
    const project = await this.deps.projectOf(args)
    const key = project.isMember
      ? project.memberTicket
      : args.ticket?.trim().toUpperCase() || 'lead'
    if (!key) {
      throw new Error('This member has no ticket, so it has no game inbox.')
    }
    const found = (await this.inboxesOf(project)).find((one) => one.key === key)
    const inbox = found ?? { key, unread: 0, messages: [], waiting: [], newest: 0 }
    if (args.markRead && inbox.newest > 0) {
      await this.deps.store.markInboxRead(project.key, key, inbox.newest)
    }
    return {
      inbox: args.unread
        ? { ...inbox, messages: inbox.messages.filter((one) => one.unread) }
        : inbox
    }
  }

  async inboxSummary(caller: GameBoardCaller): Promise<GameInboxSummary[]> {
    const project = await this.deps.projectOf(caller)
    return (await this.inboxesOf(project)).slice(0, INBOX_SUMMARY_MAX).map((inbox) => {
      const last = inbox.messages[0]
      return {
        key: inbox.key,
        unread: inbox.unread,
        last: last ? { at: last.at, from: last.from, subject: last.subject } : null,
        waiting: inbox.waiting
      }
    })
  }

  /** The person's Inbox: every ticket's thread, what waits on the lead and what it answered; reads, never marks. */
  async inboxThreads(caller: GameBoardCaller): Promise<GameInboxThreads> {
    const project = await this.deps.projectOf(caller)
    if (project.isMember) {
      throw new Error("A member reads only its own ticket's inbox: use `game inbox`.")
    }
    return project.lead
      ? gameInboxThreadsOf(this.deps.inboxSourceOf(project.lead))
      : { threads: [], waiting: [], answered: [] }
  }

  private async inboxesOf(project: GameBoardProject): Promise<GameInbox[]> {
    if (!project.lead) {
      return []
    }
    const source = this.deps.inboxSourceOf(project.lead)
    return gameInboxesOf(source, await this.deps.store.cursors(project.key))
  }

  async askOwner(
    args: GameBoardCaller & GameOwnerQuestionDraft
  ): Promise<{ question: GameOwnerQuestion }> {
    const project = await this.deps.projectOf(args)
    if (project.isMember) {
      throw new Error('A member asks its lead, never the person: use `orchestration ask`.')
    }
    const question: GameOwnerQuestion = {
      id: `oq_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      ...gameOwnerQuestionDraftOf(args),
      askedAt: this.now().toISOString(),
      answer: null
    }
    await this.deps.store.changeOwnerQuestions(project.key, (list) => ({
      list: addGameOwnerQuestion(list, question),
      result: null
    }))
    this.deps.ownerQuestionsChanged?.(project.key)
    return { question }
  }

  /** Open questions oldest first; `all` adds the answered ones kept for the audit. */
  async ownerQuestions(
    args: GameBoardCaller & { all?: boolean }
  ): Promise<{ questions: GameOwnerQuestion[]; open: number }> {
    const project = await this.deps.projectOf(args)
    const list = await this.deps.store.ownerQuestions(project.key)
    const open = openGameOwnerQuestions(list)
    return {
      questions: args.all ? list.flatMap((one) => parseGameOwnerQuestion(one) ?? []) : open,
      open: open.length
    }
  }

  /** The lead hears the answer once, as an escalation its mail watch already passes. */
  async answerOwner(
    args: GameBoardCaller & GameOwnerReply & { id: string }
  ): Promise<{ question: GameOwnerQuestion; delivered: boolean; repeated: boolean }> {
    const project = await this.deps.projectOf(args)
    if (project.isMember) {
      throw new Error('A member cannot answer a question the lead asked the person.')
    }
    const at = this.now().toISOString()
    const result = await this.deps.store.changeOwnerQuestions(project.key, (list) => {
      const outcome = answerGameOwnerQuestion(list, args.id, args, at)
      return { list: outcome.kind === 'answered' ? outcome.list : null, result: outcome }
    })
    switch (result.kind) {
      case 'not_found':
        throw new Error(`No question ${args.id} in this project.`)
      case 'invalid':
        throw new Error(result.reason)
      case 'conflict':
        throw new Error(`Question ${args.id} is already answered: ${result.question.answer?.text}`)
      case 'repeated':
        return { question: result.question, delivered: false, repeated: true }
      case 'answered': {
        this.deps.ownerQuestionsChanged?.(project.key)
        const delivered = project.lead
          ? this.deps.tellLead(project.lead, gameOwnerAnswerNote(result.question))
          : false
        return { question: result.question, delivered, repeated: false }
      }
    }
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
      ...(args.key ? { key: args.key } : {}),
      // Why not over RPC: only the host's own read of the review may call a merge perfect.
      ...(args.merge && args.kind === 'merged' ? { merge: args.merge } : {})
    }
    const { added } = await this.deps.store.appendEvent(project.key, event)
    return { posted: added, event }
  }
}
