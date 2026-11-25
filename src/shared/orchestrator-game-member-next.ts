import type { GameAgent } from './orchestrator-game-state'
import type { GameMemberPhase } from './orchestrator-game-member-phase'
import { ticketInText } from './orchestrator-game-ticket-id'
import { isAskUserQuestionTool } from './agent-question-answered-intent'
import { agentToolLabelOf } from './agent-tool-label'
import {
  finishedSignalOf,
  runDoneWaitOf,
  type MemberFinishedFacts
} from './orchestrator-game-member-finished'

const NONE_QUEUED: ReadonlySet<string> = new Set()

export function idleNextOf(review: GameAgent['review'], queued = NONE_QUEUED): string {
  if (!review) {
    return 'push'
  }
  if (review.state === 'merged') {
    return 'move the ticket to review'
  }
  if (review.state === 'closed') {
    return `check: PR #${review.number} closed`
  }
  if (queued.has(review.url)) {
    return 'wait for the merge queue'
  }
  if (review.ci === 'failure') {
    return 'push: CI failing'
  }
  return review.ci === 'pending' ? 'wait for CI' : `review PR #${review.number}`
}

/** A remote member whose host does not answer: its home dispatch is what the lead can still read (ORCA-824). */
export const silentHostNextOf = (host: string, paneKey: string): string =>
  `${host} does not answer: orca orchestration worker-show --dispatch ${paneKey.replace(/^remote:/, '')}`

const START_ERROR_MAX = 200

// Why: the host's reason goes on one `alert` line, so its newlines must not split it.
function oneLineReasonOf(error: string): string {
  const line = error
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim()
  return line.length > START_ERROR_MAX ? `${line.slice(0, START_ERROR_MAX).trimEnd()}…` : line
}

/** What a remote member asks of the lead before its phase does; null when nothing (ORCA-793). */
export function remoteNextOf(agent: GameAgent, ticket: string | null): string | null {
  const remote = agent.remote
  // Why first: the home recorded the failure, so a silent host does not hide it (ORCA-1398).
  if (remote?.startFailed) {
    const why = remote.startError
      ? `: ${oneLineReasonOf(remote.startError)}`
      : ' (no reason was published)'
    return `failed to start on ${remote.host}${why}. Find the cause before launching ${ticket ?? agent.displayName ?? agent.paneKey} again.`
  }
  // Why: a found agent has no dispatch, so lead mail cannot reach it until it is adopted (ORCA-943).
  if (remote && agent.found) {
    const adopt = `orca game adopt ${ticket ?? agent.displayName ?? agent.paneKey}`
    return remote.stateKnown
      ? `found on ${remote.host}: ${adopt} so lead mail reaches it`
      : `found on ${remote.host}, which is not answering now: ${adopt} once it answers`
  }
  if (remote?.stateKnown === false) {
    return silentHostNextOf(remote.host, agent.paneKey)
  }
  if (remote?.starting) {
    return `starting on ${remote.host}`
  }
  // Why: a finished member's closed terminal is how it ends; its phase says what is next (ORCA-854).
  if (remote?.gone && agent.state !== 'done') {
    const name = ticket ?? agent.paneKey
    // Why rebind first: a terminal replaced outside Orca leaves the member running there (CIN-1297).
    return `gone from ${remote.host}: orca game rebind ${name} if it runs on in another terminal there, else orca game stop ${name}`
  }
  return remote?.earlierLead && remote.ticketDone && finishedSignalOf(agent) !== null
    ? `left by an earlier lead, ticket done: orca game stop ${ticket ?? agent.paneKey}`
    : null
}

/** The linked ticket's status; once a remote member's home Run completed, `done` or what it still waits for. */
export function memberTicketStatusOf(
  agent: MemberFinishedFacts,
  queued = NONE_QUEUED
): string | null {
  if (agent.workItem) {
    return agent.workItem.status || agent.workItem.statusGroup
  }
  if (!agent.remote?.ticketDone) {
    return null
  }
  const wait = runDoneWaitOf(agent, queued)
  return wait ? `run done, ${wait}` : 'done'
}

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
export function phaseNextOf(
  agent: GameAgent,
  phase: GameMemberPhase,
  queued = NONE_QUEUED
): string {
  switch (phase) {
    case 'finished':
      // Why: sweep never closes a session the lead did not launch (ORCA-914).
      return agent.found
        ? `game stop ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}`
        : 'sweep --close'
    case 'needs-you':
      return agent.limit?.loggedOut ? loggedOutNextOf(agent) : paneAskNextOf(agent)
    case 'limited':
      return limitedNextOf(agent)
    case 'working':
      return 'wait'
    case 'unknown':
      return `read its terminal before acting: orca game member ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}`
    case 'asleep':
      return agent.asleepHandle
        ? `a restart slept its pane: orca terminal wake --terminal ${agent.asleepHandle}`
        : `a restart slept its pane on ${agent.remote?.host ?? 'its host'}: orca game resume-members ${ticketOfMember(agent) ?? agent.paneKey} wakes it`
    case 'idle':
      return agent.remote?.ticketDone && !agent.review
        ? `run done with no PR: open one, or game stop ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey} if nothing is ahead of main`
        : idleNextOf(agent.review, queued)
  }
}

// Why the pane: a prompt in a member's terminal is no Inbox question, so no reply can answer it (ORCA-1231).
const paneAskNextOf = (agent: GameAgent): string => {
  const where = `in its pane: open ${agent.terminalHandle ?? agent.displayName ?? agent.paneKey}`
  if (isAskUserQuestionTool(agent.toolName ?? undefined)) {
    return `question ${where}`
  }
  return agent.toolName
    ? `permission prompt (${agentToolLabelOf(agent.toolName)}) ${where}`
    : `permission prompt ${where}`
}

const loggedOutNextOf = (agent: GameAgent): string =>
  `log ${agent.account?.email ?? 'its account'} in again (/login in its pane), or game move ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}`

const limitedNextOf = (agent: GameAgent): string =>
  `game move ${ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey}, or wait for the reset`
