import type { GameAgent } from './orchestrator-game-state'

/** Why a member's work counts as finished, or null; its live state is not consulted here. */
export function finishedSignalOf(agent: GameAgent): string | null {
  const { review, workItem } = agent
  const group = workItem?.statusGroup
  if (
    review?.state === 'merged' &&
    (group === undefined || group === 'review' || group === 'done')
  ) {
    return workItem
      ? `PR #${review.number} merged, ticket ${workItem.status || workItem.statusGroup}`
      : `PR #${review.number} merged`
  }
  return agent.remote?.ticketDone ? 'its home Run completed the task' : null
}

// Why (ORCA-862): a merge or a settled Run does not stop the agent (ORCA-837); live state wins, as in `game state`.
const BUSY: ReadonlySet<GameAgent['state']> = new Set(['working', 'waiting'])

export function isFinishedMember(agent: GameAgent): boolean {
  return !BUSY.has(agent.state) && finishedSignalOf(agent) !== null
}
