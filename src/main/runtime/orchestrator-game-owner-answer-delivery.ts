import type { GameHistoryStore } from './orchestrator-game-history-store'
import type { GameBoardLead, GameBoardProject, GameLeadNote } from './orchestrator-game-board'
import {
  deliverGameOwnerAnswers,
  gameOwnerAnswerNote,
  parseGameOwnerQuestion,
  type GameOwnerQuestion
} from '../../shared/orchestrator-game-owner-questions'

export type TellGameLead = (lead: GameBoardLead, note: GameLeadNote) => boolean

/** Tells the project's current lead one answer; a member or a project with no lead takes none. */
export function ownerAnswerTellerOf(
  project: GameBoardProject,
  tellLead: TellGameLead
): (question: GameOwnerQuestion) => boolean {
  const lead = project.isMember ? null : project.lead
  return lead ? (question) => tellLead(lead, gameOwnerAnswerNote(question)) : () => false
}

/** Answers no lead received yet, each as it is after handing it to the project's current lead (ORCA-942). */
export async function deliverHeldOwnerAnswers(
  store: Pick<GameHistoryStore, 'ownerQuestions' | 'changeOwnerQuestions'>,
  project: GameBoardProject,
  tellLead: TellGameLead
): Promise<GameOwnerQuestion[]> {
  if (project.isMember) {
    return []
  }
  // Why read first: every inbox read lands here, and only a held answer needs the write queue.
  const list = await store.ownerQuestions(project.key)
  if (!list.some((one) => parseGameOwnerQuestion(one)?.answer?.undelivered)) {
    return []
  }
  const tell = ownerAnswerTellerOf(project, tellLead)
  return store.changeOwnerQuestions(project.key, (current) => {
    const sent = deliverGameOwnerAnswers(current, tell)
    return { list: sent.list, result: sent.held }
  })
}
