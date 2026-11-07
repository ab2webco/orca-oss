import type { GameHistoryStore } from './orchestrator-game-history-store'
import type {
  GameBoardCaller,
  GameBoardLead,
  GameBoardProject,
  GameLeadNote
} from './orchestrator-game-board'
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

// Why 15 s for 10 min: a lead back from a restart or a --fresh rotation is live again by then (ORCA-1100).
const HELD_RETRY_MS = 15_000
const HELD_RETRY_MAX = 40

const laterUnref = (ms: number, run: () => void): void => {
  setTimeout(run, ms).unref?.()
}

/** What HeldOwnerAnswers reads from its board, looked up on each call. */
type HeldOwnerAnswerDeps = {
  store: Pick<GameHistoryStore, 'ownerQuestions' | 'changeOwnerQuestions'>
  projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
  tellLead: TellGameLead
  ownerQuestionsChanged?: (projectKey: string) => void
  later?: (ms: number, run: () => void) => void
}

/** Answers no lead took yet: handed over on demand, and retried on a timer, since a lead parked on its watch makes no read (ORCA-1100). */
export class HeldOwnerAnswers {
  private readonly retrying = new Set<string>()

  constructor(private readonly deps: () => HeldOwnerAnswerDeps) {}

  /** Hands them to the project's live lead; resolves to the ones still held. */
  async deliver(caller: GameBoardCaller): Promise<GameOwnerQuestion[]> {
    const { store, projectOf, tellLead, ownerQuestionsChanged } = this.deps()
    const project = await projectOf(caller)
    const handed = await deliverHeldOwnerAnswers(store, project, tellLead)
    const held = handed.filter((one) => one.answer?.undelivered)
    if (held.length < handed.length) {
      ownerQuestionsChanged?.(project.key)
    }
    return held
  }

  retry(caller: GameBoardCaller, projectKey: string): void {
    if (this.retrying.has(projectKey)) {
      return
    }
    this.retrying.add(projectKey)
    const later = this.deps().later ?? laterUnref
    const attempt = (left: number): void =>
      later(HELD_RETRY_MS, () => {
        void this.deliver({ worktreeId: caller.worktreeId, terminalHandle: caller.terminalHandle })
          .catch(() => null)
          .then((held) => {
            if ((held === null || held.length > 0) && left > 1) {
              attempt(left - 1)
            } else {
              this.retrying.delete(projectKey)
            }
          })
      })
    attempt(HELD_RETRY_MAX)
  }
}
