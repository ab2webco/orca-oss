import { ticketOfMember } from './orchestrator-game-fleet-verbs'
import type { GameEventKind } from './orchestrator-game-events'
import type { GameAgent } from './orchestrator-game-state'

export type ObservedGameEvent = {
  kind: Extract<GameEventKind, 'merged' | 'qa_handoff'>
  ticket: string
  text: string
  /** The board keeps one event per key, so a fleet read on every turn posts it once. */
  key: string
}

/** What `game fleet` and `game sweep` see happened to members: a merged PR, a ticket handed to QA. */
export function observedGameEventsOf(agents: readonly GameAgent[]): ObservedGameEvent[] {
  return agents.flatMap((agent): ObservedGameEvent[] => {
    const ticket = agent.isMember && !agent.isLeader && !agent.found ? ticketOfMember(agent) : null
    if (!ticket) {
      return []
    }
    const pr = agent.review ? `#${agent.review.number}` : '-'
    const events: ObservedGameEvent[] = []
    if (agent.review?.state === 'merged') {
      events.push({
        kind: 'merged',
        ticket,
        text: `PR ${pr} merged`,
        key: `merged ${ticket} ${pr}`
      })
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
