import type { GameAgent } from './orchestrator-game-state'
import type { GameMemberPhase } from './orchestrator-game-fleet-verbs'
import { ticketInText } from './orchestrator-game-ticket-id'

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
    return `gone from ${remote.host}: orca game stop ${ticket ?? agent.paneKey}`
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

// Why the name and branch: `game launch` names the member after its ticket before any ticket is linked.
export function ticketOfMember(agent: GameAgent): string | null {
  if (agent.workItem) {
    return agent.workItem.identifier.toUpperCase()
  }
  for (const text of [agent.displayName, agent.worktree?.displayName, agent.worktree?.branch]) {
    const ticket = ticketInText(text)
    if (ticket) {
      return ticket
    }
  }
  return null
}

/** What the lead does next for a member, from its phase alone. */
export function phaseNextOf(agent: GameAgent, phase: GameMemberPhase): string {
  switch (phase) {
    case 'finished':
      // Why: sweep never closes a session the lead did not launch (ORCA-914).
      return agent.found
        ? `game stop ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}`
        : 'sweep --close'
    case 'needs-you':
      return agent.limit?.loggedOut ? loggedOutNextOf(agent) : 'answer it'
    case 'limited':
      return limitedNextOf(agent)
    case 'working':
      return 'wait'
    case 'idle':
      return idleNextOf(agent.review)
  }
}

const loggedOutNextOf = (agent: GameAgent): string =>
  `log ${agent.account?.email ?? 'its account'} in again (/login in its pane), or game move ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}`

const limitedNextOf = (agent: GameAgent): string =>
  `game move ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}, or wait for the reset`
