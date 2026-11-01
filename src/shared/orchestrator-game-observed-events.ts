import { ticketOfMember } from './orchestrator-game-fleet-verbs'
import type { GameEventKind, GameEventMerge } from './orchestrator-game-events'
import type { GameAgent } from './orchestrator-game-state'

export type ObservedGameEvent = {
  kind: Extract<GameEventKind, 'merged' | 'qa_handoff'>
  ticket: string
  text: string
  /** The board keeps one event per key, so a fleet read on every turn posts it once. */
  key: string
}

const prOf = (agent: GameAgent): string => (agent.review ? `#${agent.review.number}` : '-')

const mergedEventOf = (ticket: string, agent: GameAgent): ObservedGameEvent => ({
  kind: 'merged',
  ticket,
  text: `PR ${prOf(agent)} merged`,
  key: `merged ${ticket} ${prOf(agent)}`
})

/** What `game fleet` and `game sweep` see happened to members: a merged PR, a ticket handed to QA. */
export function observedGameEventsOf(agents: readonly GameAgent[]): ObservedGameEvent[] {
  return agents.flatMap((agent): ObservedGameEvent[] => {
    const ticket = agent.isMember && !agent.isLeader && !agent.found ? ticketOfMember(agent) : null
    if (!ticket) {
      return []
    }
    const pr = prOf(agent)
    const events: ObservedGameEvent[] = []
    if (agent.review?.state === 'merged') {
      events.push(mergedEventOf(ticket, agent))
    }
    if (agent.workItem?.statusGroup === 'review') {
      events.push({
        kind: 'qa_handoff',
        ticket,
        text: `ticket ${agent.workItem.status || 'in review'}`,
        key: `qa_handoff ${ticket} ${pr}`
      })
    }
    return events
  })
}

/**
 * The merged event of each member whose review the host reads as merged, with the review its lead's
 * rewards need: the member may be freed before the lead's next poll sees it (ORCA-887).
 */
export function observedMergesOf(
  agents: readonly GameAgent[]
): (ObservedGameEvent & { merge: GameEventMerge })[] {
  return agents.flatMap((agent) => {
    const ticket = agent.isMember && !agent.isLeader && !agent.found ? ticketOfMember(agent) : null
    const review = agent.review
    if (!ticket || !agent.worktree || review?.state !== 'merged') {
      return []
    }
    const merge = {
      provider: review.provider,
      number: review.number,
      worktreeId: agent.worktree.id,
      perfect: review.perfectMerge === true
    }
    return [{ ...mergedEventOf(ticket, agent), merge }]
  })
}
