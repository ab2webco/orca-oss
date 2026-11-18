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

export async function readRemoteMemberOwnerAnswer(
  store: GameHistoryStore,
  dispatchId: string,
  id: string
): Promise<{ question: GameOwnerQuestion }> {
  const list = await store.ownerQuestions(keyOf(dispatchId))
  const question = list
    .flatMap((one) => parseGameOwnerQuestion(one) ?? [])
    .find((one) => one.id === id)
  if (!question) {
    throw new Error(
      `No question ${id} for your ticket reached this host. Your lead's host shares the person's answers on your ticket each time it sends you mail.`
    )
  }
  return { question }
}

export type RemoteMemberOwnerAnswerShare = {
  /** The member's ticket, its lead's board and the host it runs on; null for a non-game worker. */
  memberOf: (
    dispatchId: string
  ) => Promise<{ ticket: string; projectKey: string; environmentId: string } | null>
  questionsOf: (projectKey: string) => Promise<readonly unknown[]>
  send: (environmentId: string, shared: RemoteMemberOwnerAnswers) => Promise<unknown>
  /** What each dispatch last received, so an unchanged set is not sent again. */
  sent: Map<string, string>
}

/** On the lead's host, before a member's mail goes out: never fails that mail, since an older host lacks the call. */
export async function shareOwnerAnswersWithRemoteMember(
  deps: RemoteMemberOwnerAnswerShare,
  dispatchId: string
): Promise<void> {
  try {
    const member = await deps.memberOf(dispatchId)
    if (!member) {
      return
    }
    const questions = (await deps.questionsOf(member.projectKey))
      .flatMap((one) => parseGameOwnerQuestion(one) ?? [])
      .filter((one) => sameTicket(one, member.ticket))
    const signature = JSON.stringify(questions)
    if (questions.length === 0 || deps.sent.get(dispatchId) === signature) {
      return
    }
    await deps.send(member.environmentId, { dispatchId, ticket: member.ticket, questions })
    deps.sent.set(dispatchId, signature)
  } catch {
    // Why swallowed: the member then asks the person, as it did before this was shared.
  }
}
