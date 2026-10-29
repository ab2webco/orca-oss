import { ticketOfMember } from './orchestrator-game-fleet-verbs'
import type { GameAgent } from './orchestrator-game-state'

/** A member Orca releases on its own: it reported worker_done and its work landed (ORCA-864). */
export type GameAutoReleaseCandidate = {
  agent: GameAgent
  ticket: string | null
  dispatchId: string
  /** What proves the work landed, for the lead's line. */
  why: string
}

// Why (ORCA-862): a merge does not stop the agent (ORCA-837), so a member still at work is never touched.
const BUSY: ReadonlySet<GameAgent['state']> = new Set(['working', 'waiting'])

/** Why the member's work landed, or null: a merged PR, or a ticket its tracker calls Done. */
export function landedSignalOf(agent: GameAgent): string | null {
  if (agent.review?.state === 'merged') {
    return `PR #${agent.review.number} merged`
  }
  return agent.workItem?.statusGroup === 'done' ? `ticket ${agent.workItem.identifier} Done` : null
}

/** A remote member's home dispatch, read from its pane key. */
export const remoteDispatchIdOf = (agent: GameAgent): string | null =>
  agent.remote && agent.paneKey.startsWith('remote:') ? agent.paneKey.slice('remote:'.length) : null

/**
 * Members whose work landed, that are not at work, and whose dispatch took a worker_done.
 * `reportedDispatchOf` answers that dispatch, or null when the member never reported.
 */
export function gameAutoReleaseCandidatesOf(
  agents: readonly GameAgent[],
  reportedDispatchOf: (agent: GameAgent) => string | null
): GameAutoReleaseCandidate[] {
  return agents.flatMap((agent) => {
    if (!agent.isMember || agent.isLeader || BUSY.has(agent.state)) {
      return []
    }
    const why = landedSignalOf(agent)
    const dispatchId = why ? reportedDispatchOf(agent) : null
    return why && dispatchId ? [{ agent, ticket: ticketOfMember(agent), dispatchId, why }] : []
  })
}
