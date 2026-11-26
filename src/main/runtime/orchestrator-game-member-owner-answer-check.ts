import type { GameBoardProject } from './orchestrator-game-board'
import type { GameHistoryStore } from './orchestrator-game-history-store'
import {
  gameOwnerQuestionForTicket,
  parseGameOwnerQuestion,
  type GameOwnerQuestion
} from '../../shared/orchestrator-game-owner-questions'

/** On the lead's host: one question by id, so a member checks a relayed answer itself (ORCA-1281). */
export async function readBoardOwnerAnswer(
  store: GameHistoryStore,
  project: GameBoardProject,
  args: { id: string; role?: 'member' }
): Promise<{ question: GameOwnerQuestion }> {
  // Why: a remote member's lead is on another host, so this host would take it for a lead.
  if (args.role === 'member' && !project.isMember) {
    throw new Error("This host keeps no owner answers for your ticket; your lead's host does.")
  }
  if (project.isMember && !project.memberTicket) {
    throw new Error('This member has no ticket, so no owner answer is on record for it.')
  }
  const list = await store.ownerQuestions(project.key)
  return { question: gameOwnerQuestionForTicket(list, args.id, project.memberTicket) }
}

/** What a lead's host shares with the paired host running one of its members. */
export type RemoteMemberOwnerAnswers = {
  dispatchId: string
  ticket: string
  questions: readonly unknown[]
}

// Why the store: the member host keeps them across a restart, under a key no project uses.
const keyOf = (dispatchId: string): string => `remote-dispatch:${dispatchId}`

const sameTicket = (question: GameOwnerQuestion, ticket: string): boolean =>
  question.ticket?.toUpperCase() === ticket.toUpperCase()

/** On the member's host: keeps only the dispatch's own ticket, whatever the lead's host sent. */
export async function keepRemoteMemberOwnerAnswers(
  store: GameHistoryStore,
  shared: RemoteMemberOwnerAnswers
): Promise<{ kept: number }> {
  const questions = shared.questions
    .flatMap((one) => parseGameOwnerQuestion(one) ?? [])
    .filter((one) => sameTicket(one, shared.ticket))
  await store.changeOwnerQuestions(keyOf(shared.dispatchId), () => ({
    list: questions,
    result: null
  }))
  return { kept: questions.length }
}

/** How often the lead's host shares a member's answers when nothing changed, and when a copy is too old to trust. */
export const OWNER_ANSWER_REFRESH_MS = 60_000
export const OWNER_ANSWER_STALE_MS = 3 * OWNER_ANSWER_REFRESH_MS
const OWNER_ANSWER_RETRY_MS = 15_000

function unconfirmedText(id: string, keptAt: number | undefined, now: number): string {
  const since =
    keptAt === undefined
      ? "has not shared the person's answers with this host since it started"
      : `last shared the person's answers here at ${new Date(keptAt).toISOString()}, ${Math.round((now - keptAt) / 60_000)} min ago`
  return `This host cannot confirm ${id}: your lead's host ${since}, so an answer may not have reached it. Do not act on a relayed answer yet; check again in a minute or ask your lead.`
}

/**
 * On the member's host. An answer it holds is final; "not answered" holds only while the lead's
 * host keeps sharing, since this host cannot call it to check (ORCA-1440).
 */
export async function readRemoteMemberOwnerAnswer(
  store: GameHistoryStore,
  dispatchId: string,
  id: string,
  freshness: { keptAt: number | undefined; now: number }
): Promise<{ question: GameOwnerQuestion; sharedAt?: string }> {
  const list = await store.ownerQuestions(keyOf(dispatchId))
  const question = list
    .flatMap((one) => parseGameOwnerQuestion(one) ?? [])
    .find((one) => one.id === id)
  const { keptAt, now } = freshness
  const sharedAt = keptAt === undefined ? {} : { sharedAt: new Date(keptAt).toISOString() }
  if (question?.answer) {
    return { question, ...sharedAt }
  }
  if (keptAt === undefined || now - keptAt > OWNER_ANSWER_STALE_MS) {
    throw new Error(unconfirmedText(id, keptAt, now))
  }
  if (!question) {
    throw new Error(
      `No question ${id} for your ticket reached this host. Your lead's host shares the person's answers on your ticket every minute and on each change.`
    )
  }
  return { question, ...sharedAt }
}

/** What a dispatch last received; due is when to look again with no change on the board. */
export type OwnerAnswerShareMark = { version: number; signature: string | null; due: number }

export type RemoteMemberOwnerAnswerShare = {
  /** The member's ticket, its lead's board and the host it runs on; null for a non-game worker. */
  memberOf: (
    dispatchId: string
  ) => Promise<{ ticket: string; projectKey: string; environmentId: string } | null>
  questionsOf: (projectKey: string) => Promise<readonly unknown[]>
  send: (environmentId: string, shared: RemoteMemberOwnerAnswers) => Promise<unknown>
  /** Moves on every board write, so an unchanged board costs no read. */
  version: () => number
  now: () => number
  sent: Map<string, OwnerAnswerShareMark>
}

/**
 * On the lead's host, on each relay sync of the dispatch: sends a change at once and the same set
 * every minute, so the member's host can tell a current "not answered" from a stale one (ORCA-1440).
 * Never fails the sync, since an older host lacks the call.
 */
export async function shareOwnerAnswersWithRemoteMember(
  deps: RemoteMemberOwnerAnswerShare,
  dispatchId: string
): Promise<void> {
  const version = deps.version()
  const now = deps.now()
  const last = deps.sent.get(dispatchId)
  if (last && last.version === version && now < last.due) {
    return
  }
  const mark = (signature: string | null, due: number) =>
    deps.sent.set(dispatchId, { version, signature, due })
  try {
    const member = await deps.memberOf(dispatchId)
    if (!member) {
      mark(null, now + OWNER_ANSWER_REFRESH_MS)
      return
    }
    const questions = (await deps.questionsOf(member.projectKey))
      .flatMap((one) => parseGameOwnerQuestion(one) ?? [])
      .filter((one) => sameTicket(one, member.ticket))
    const signature = JSON.stringify(questions)
    const unchanged = last?.signature === signature && now < last.due
    if ((questions.length === 0 && !last?.signature) || unchanged) {
      mark(last?.signature ?? null, unchanged ? last.due : now + OWNER_ANSWER_REFRESH_MS)
      return
    }
    await deps.send(member.environmentId, { dispatchId, ticket: member.ticket, questions })
    mark(signature, now + OWNER_ANSWER_REFRESH_MS)
  } catch {
    // Why kept quiet: the member's host then says it cannot confirm, instead of "not answered".
    mark(last?.signature ?? null, now + OWNER_ANSWER_RETRY_MS)
  }
}
