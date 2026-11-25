import type { GameAgent, GameReview, GameWorkItem } from './orchestrator-game-state'
import type { GameRemoteHost } from './orchestrator-game-remote-host'
import {
  gameTicketKindOf,
  type GameLaunchChosenBy,
  type GameTicketKind
} from './orchestrator-game-ticket-kind'

/** What the finished rule reads of a member, so the phone's row passes it without a GameAgent cast (ORCA-1405). */
export type MemberFinishedFacts = {
  displayName: string | null
  review?: Pick<GameReview, 'number' | 'url' | 'state'>
  workItem?: Pick<GameWorkItem, 'status' | 'statusGroup'>
  remote?: Pick<GameRemoteHost, 'ticketDone'>
  launch?: { chosenBy?: Pick<GameLaunchChosenBy, 'kind'> }
}

// Why (ORCA-1397): these kinds end without a PR; an implementation's completed Run is not its merge.
const NO_PR_KINDS: ReadonlySet<GameTicketKind> = new Set(['audit', 'review', 'captures'])

const prOpen = (review: MemberFinishedFacts['review']): boolean =>
  review?.state === 'open' || review?.state === 'draft'

/** Why a member's work counts as finished, or null; its live state is not consulted here. */
export function finishedSignalOf(agent: MemberFinishedFacts): string | null {
  const { review, workItem } = agent
  const group = workItem?.statusGroup
  // Why the gate on closed too (ORCA-1397 review): a member closes its PR to split or replace it mid-work.
  if (
    (review?.state === 'merged' || review?.state === 'closed') &&
    (group === undefined || group === 'review' || group === 'done')
  ) {
    return workItem
      ? `PR #${review.number} ${review.state}, ticket ${workItem.status || workItem.statusGroup}`
      : `PR #${review.number} ${review.state}`
  }
  const kind = launchKindOf(agent)
  return agent.remote?.ticketDone && kind && NO_PR_KINDS.has(kind) && !prOpen(review)
    ? `its home Run completed the ${kind} task, no PR needed`
    : null
}

// Why the title fallback: --model, Codex, older hosts and a moved model leave no chosenBy; the title is what game launch reads.
const launchKindOf = (agent: MemberFinishedFacts): GameTicketKind | null =>
  agent.launch?.chosenBy?.kind ?? gameTicketKindOf(agent.displayName ?? '')

/** What a member whose home Run completed still waits for; null when finished or its Run is not done. */
export function runDoneWaitOf(
  agent: MemberFinishedFacts,
  queued: ReadonlySet<string>
): string | null {
  const { review } = agent
  if (!agent.remote?.ticketDone || finishedSignalOf(agent) !== null) {
    return null
  }
  if (!review) {
    return 'no PR'
  }
  return queued.has(review.url)
    ? `PR #${review.number} in the merge queue`
    : `PR #${review.number} ${review.state}`
}

// Why (ORCA-862): a merge or a settled Run does not stop the agent (ORCA-837); live state wins, as in `game state`.
const BUSY: ReadonlySet<GameAgent['state']> = new Set(['working', 'waiting'])

export function isFinishedMember(agent: GameAgent): boolean {
  return !BUSY.has(agent.state) && finishedSignalOf(agent) !== null
}
