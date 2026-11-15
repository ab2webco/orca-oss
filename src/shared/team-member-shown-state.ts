import { agentToolLabelOf } from './agent-tool-label'
import { isAskUserQuestionTool } from './agent-question-answered-intent'
import type { GameAgent, GameReview } from './orchestrator-game-state'
import type { TeamCondition, TeamMemberAsk, TeamMemberCard } from './team-panel-model-types'

// Why one module: the desktop cards, the phone's rows and the scene must state one derived truth
// about a member (ORCA-1205, ORCA-1231).

type Work = { review: GameReview | null; workItem: GameAgent['workItem'] | null }

const isOpenReview = (review: { state: string } | null | undefined): boolean =>
  review?.state === 'open' || review?.state === 'draft'

export const isFinishedWork = (work: Work): boolean =>
  work.review?.state === 'merged' || work.workItem?.statusGroup === 'done'

export const isRedCiReview = (review: GameReview | null): boolean =>
  isOpenReview(review) && review?.ci === 'failure'

/** A turn that ended is not finished work: "done" waits for a merge or green CI (ORCA-1205). */
export const shownConditionOf = (condition: TeamCondition, work: Work): TeamCondition =>
  condition !== 'done' ||
  isFinishedWork(work) ||
  (isOpenReview(work.review) && work.review?.ci === 'success')
    ? condition
    : 'idle'

/** The open PR's CI a member that stopped waits on; null while it works or has nothing to say. */
export function teamIdleCiOf(
  card: Pick<TeamMemberCard, 'condition' | 'liveAction' | 'pr'>
): 'failure' | 'pending' | null {
  const stopped = card.condition === 'idle' || card.condition === 'done'
  const ci = stopped && card.liveAction === null && isOpenReview(card.pr) ? card.pr?.ci : null
  return ci === 'failure' || ci === 'pending' ? ci : null
}

// Why not these: a closed, failed or paused session runs nothing the lead could wait on.
const HELD: ReadonlySet<TeamCondition> = new Set(['gone', 'startFailed', 'paused'])

/** A member a lead whose turn ended still waits on. */
export const isPendingMember = (card: Pick<TeamMemberCard, 'status' | 'condition'>): boolean =>
  card.status !== 'done' && card.status !== 'closed' && !HELD.has(card.condition)

/** What a member waits on the person for. Why the Inbox first: an answer there is what it waits on. */
export function memberAskOf(agent: GameAgent, inboxQuestion: boolean): TeamMemberAsk | null {
  if (inboxQuestion) {
    return { kind: 'inbox' }
  }
  if (agent.state !== 'waiting' || agent.limit?.loggedOut) {
    return null
  }
  return isAskUserQuestionTool(agent.toolName ?? undefined)
    ? { kind: 'question' }
    : { kind: 'permission', tool: agent.toolName ? agentToolLabelOf(agent.toolName) : null }
}
