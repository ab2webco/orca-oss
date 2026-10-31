import type { GameAgent } from './orchestrator-game-state'

export function idleNextOf(review: GameAgent['review']): string {
  if (!review) {
    return 'push'
  }
  if (review.state === 'merged') {
    return 'move the ticket to review'
  }
  if (review.state === 'closed') {
    return `check: PR #${review.number} closed`
  }
  if (review.ci === 'failure') {
    return 'push: CI failing'
  }
  return review.ci === 'pending' ? 'wait for CI' : `review PR #${review.number}`
}

/** A remote member whose host does not answer: its home dispatch is what the lead can still read (ORCA-824). */
export const silentHostNextOf = (host: string, paneKey: string): string =>
  `${host} does not answer: orca orchestration worker-show --dispatch ${paneKey.replace(/^remote:/, '')}`

/** What a remote member asks of the lead before its phase does; null when nothing (ORCA-793). */
export function remoteNextOf(agent: GameAgent, ticket: string | null): string | null {
  const remote = agent.remote
  if (remote?.stateKnown === false) {
    return silentHostNextOf(remote.host, agent.paneKey)
  }
  // Why: a finished member's closed terminal is how it ends; its phase says what is next (ORCA-854).
  if (remote?.gone && agent.state !== 'done') {
    const name = ticket ?? agent.paneKey
    // Why rebind first: a terminal replaced outside Orca leaves the member running there (CIN-1297).
    return `gone from ${remote.host}: orca game rebind ${name} if it runs on in another terminal there, else orca game stop ${name}`
  }
  return remote?.earlierLead && remote.ticketDone
    ? `left by an earlier lead, ticket done: orca game stop ${ticket ?? agent.paneKey}`
    : null
}

/** The linked ticket's status, or `done` once the home Run completed a remote member's task. */
export const memberTicketStatusOf = (agent: GameAgent): string | null =>
  agent.workItem
    ? agent.workItem.status || agent.workItem.statusGroup
    : agent.remote?.ticketDone
      ? 'done'
      : null
