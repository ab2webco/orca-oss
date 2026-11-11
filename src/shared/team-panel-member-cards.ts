import { agentToolLabelOf } from './agent-tool-label'
import type { GamePausedMember, GameQueuedMember } from './orchestrator-game-member-sessions'
import {
  characterKeyOf,
  leadCharacterOf,
  memberNameOf,
  memberRosterOf
} from './orchestrator-game-member-names'
import type { GameMemberName } from './orchestrator-game-member-names'
import type { GameAgent, GameReview, OrchestratorGameState } from './orchestrator-game-state'
import { ticketInText } from './orchestrator-game-ticket-id'
import { teamFlowPhaseOf } from './team-flow-phase'
import { memberNamesOf } from './team-panel-member-names'
import type {
  TeamAccount,
  TeamCondition,
  TeamHost,
  TeamLeadCard,
  TeamLiveAction,
  TeamMemberCard,
  TeamModel,
  TeamPullRequest,
  TeamStatus,
  TeamTicket
} from './team-panel-model-types'

export type TeamCards = { lead: TeamLeadCard; members: TeamMemberCard[] }

type Work = { review: GameReview | null; workItem: GameAgent['workItem'] | null }

const STATUS_RANK: Record<TeamStatus, number> = {
  attention: 0,
  risk: 1,
  working: 2,
  done: 3,
  idle: 4
}

const conditionOf = (agent: GameAgent): TeamCondition => {
  const remote = agent.remote
  if (remote?.startFailed) {
    return 'startFailed'
  }
  if (remote?.gone) {
    return 'gone'
  }
  if (remote?.asleep) {
    return 'asleep'
  }
  if (remote && !remote.stateKnown) {
    return 'unreachable'
  }
  if (agent.limit) {
    return agent.limit.loggedOut ? 'loggedOut' : 'limited'
  }
  return agent.state
}

const isFinished = (work: Work): boolean =>
  work.review?.state === 'merged' || work.workItem?.statusGroup === 'done'

// Why: red is "needs you or failed", amber "at risk", green only "done and verified". Failed CI
// stays on the PR chip, as V28 draws it, so a member fixing it still reads as working.
const statusOf = (condition: TeamCondition, needsYou: boolean, work: Work): TeamStatus => {
  if (needsYou) {
    return 'attention'
  }
  switch (condition) {
    case 'gone':
    case 'startFailed':
    case 'loggedOut':
      return 'attention'
    case 'unreachable':
    case 'asleep':
    case 'limited':
    case 'paused':
      return 'risk'
    case 'working':
    case 'starting':
      return 'working'
    case 'waiting':
    case 'idle':
    case 'done':
    case 'queued':
      return isFinished(work) ? 'done' : 'idle'
  }
}

const hostOf = (agent: GameAgent): TeamHost =>
  agent.remote
    ? {
        kind: 'remote',
        name: agent.remote.host,
        environmentId: agent.remote.environmentId ?? null,
        reachable: agent.remote.stateKnown
      }
    : { kind: 'local' }

const modelOf = (
  agent: GameAgent,
  fallback?: { model?: string; effort?: string }
): TeamModel | null => {
  if (agent.advisor?.model) {
    return { label: agent.advisor.model, effort: agent.advisor.effort, source: 'advisor' }
  }
  if (agent.launch?.model) {
    return {
      label: agent.launch.model,
      effort: agent.launch.effort,
      source: agent.launch.source ?? 'launch'
    }
  }
  return fallback?.model
    ? { label: fallback.model, effort: fallback.effort ?? null, source: 'launch' }
    : null
}

// Why: a worker's Bash line carries its dispatch capability, a bearer secret no card may show.
const DISPATCH_CAPABILITY = /dcap_[A-Za-z0-9_-]+/g
const redactedDetailOf = (text: string | null | undefined): string | null =>
  text ? text.replace(DISPATCH_CAPABILITY, '[redacted]') : null

// Why: an agent keeps its last tool after it stops; only a working or waiting one is on it now.
const isActive = (agent: GameAgent): boolean =>
  agent.state === 'working' || agent.state === 'waiting'

const liveActionOf = (agent: GameAgent): TeamLiveAction | null => {
  if (!isActive(agent)) {
    return null
  }
  if (agent.activity?.running) {
    const { name, id, url, running } = agent.activity
    return { kind: 'link', name, id, url, running }
  }
  return agent.toolName
    ? {
        kind: 'tool',
        tool: agentToolLabelOf(agent.toolName),
        detail: redactedDetailOf(agent.toolInput)
      }
    : null
}

const ticketOf = (agent: GameAgent, name: string): TeamTicket | null => {
  const item = agent.workItem
  if (item) {
    return {
      identifier: item.identifier.toUpperCase(),
      title: item.title || null,
      url: item.url || null,
      statusGroup: item.statusGroup
    }
  }
  const identifier = ticketInText(name) ?? ticketInText(agent.worktree?.branch)
  return identifier ? { identifier, title: null, url: null, statusGroup: null } : null
}

const pullRequestOf = (review: GameReview | null): TeamPullRequest | null =>
  review && {
    provider: review.provider,
    number: review.number,
    title: review.title,
    url: review.url,
    state: review.state,
    ci: review.ci,
    verdict: review.verdict ?? null,
    perfectMerge: review.perfectMerge ?? null
  }

const accountOf = (agent: GameAgent, state: OrchestratorGameState): TeamAccount | null => {
  if (!agent.account) {
    return null
  }
  const { provider, email } = agent.account
  const usage = state.metrics?.claudeAccounts?.find((one) => one.email === email)
  return { provider, email, usedPercent: usage?.sessionPercent ?? null }
}

const workOf = (agent: GameAgent): Work => ({
  review: agent.review ?? null,
  workItem: agent.workItem ?? null
})

// Why: the roster folds `Merlín` and `Merlin` into one key, so the look never follows the pane.
const characterOf = (roster: readonly GameMemberName[], shown: string | null): string | null => {
  const name = (memberNameOf(shown) ?? shown)?.trim()
  return name ? characterKeyOf(roster, name) : null
}

function memberCardOf(
  agent: GameAgent,
  state: OrchestratorGameState,
  questionTickets: ReadonlySet<string>,
  roster: readonly GameMemberName[],
  given: string | null
): TeamMemberCard {
  const shown = agent.displayName ?? agent.worktree?.displayName ?? agent.paneKey
  const ticket = ticketOf(agent, shown)
  const work = workOf(agent)
  const condition = conditionOf(agent)
  const needsYou =
    agent.state === 'waiting' || (ticket !== null && questionTickets.has(ticket.identifier))
  const inbox = ticket && state.inboxes?.find((one) => one.key === ticket.identifier)
  return {
    paneKey: agent.paneKey,
    terminalHandle: agent.terminalHandle ?? null,
    // Why: game.state omits a local member's worktree when it is the lead's.
    worktreeId: agent.worktree?.id ?? (agent.remote ? null : (state.worktree?.id ?? null)),
    host: hostOf(agent),
    // Why the ticket: with no character to give, the ticket names it once, as the sidebar shows it.
    name: given ?? ticket?.identifier ?? shown,
    agentType: agent.agentType,
    status: statusOf(condition, needsYou, work),
    condition,
    since: agent.stateSince ?? null,
    liveAction: liveActionOf(agent),
    model: modelOf(agent),
    account: accountOf(agent, state),
    characterKey: given ? characterKeyOf(roster, given) : characterOf(roster, agent.displayName),
    ticket,
    flowPhase: teamFlowPhaseOf(agent),
    summary: inbox?.last?.subject ?? null,
    pr: pullRequestOf(work.review),
    needsYou,
    limitResetsAt: agent.limit?.resetsAt ?? null,
    found: agent.found === true
  }
}

function offlineCardOf(
  member: GamePausedMember | GameQueuedMember,
  condition: 'paused' | 'queued',
  roster: readonly GameMemberName[]
): TeamMemberCard {
  const paused = condition === 'paused' ? (member as GamePausedMember) : null
  const since = paused ? Date.parse(paused.since) : Number.NaN
  return {
    paneKey: `${condition}:${member.ticket}`,
    terminalHandle: paused?.terminal ?? null,
    worktreeId: null,
    host: { kind: 'local' },
    name: member.name ?? member.ticket,
    agentType: paused?.agent ?? null,
    status: condition === 'paused' ? 'risk' : 'idle',
    condition,
    since: Number.isNaN(since) ? null : since,
    liveAction: null,
    model: null,
    account: null,
    characterKey: characterOf(roster, member.name),
    ticket: { identifier: member.ticket, title: null, url: null, statusGroup: null },
    flowPhase: null,
    summary: null,
    pr: null,
    needsYou: false,
    limitResetsAt: null,
    found: false
  }
}

/** The lead and member cards of a game project; null when the state has no lead. */
export function teamCardsOf(
  state: OrchestratorGameState,
  questionTickets: ReadonlySet<string>,
  ownerAsk: { ticket: string | null } | null = null,
  locale = 'en'
): TeamCards | null {
  const leader = state.agents.find((one) => one.isLeader)
  if (!leader) {
    return null
  }
  const condition = conditionOf(leader)
  const roster = memberRosterOf({ ...state, config: state.config ?? {} })
  const lead: TeamLeadCard = {
    paneKey: leader.paneKey,
    terminalHandle: leader.terminalHandle ?? null,
    worktreeId: state.worktree?.id ?? null,
    host: hostOf(leader),
    // Why leadName first: the host keeps it for the session, so a scene or language change cannot rename the lead.
    name:
      state.leadName ??
      state.lead?.label ??
      leadCharacterOf(roster, locale) ??
      leader.displayName ??
      state.worktree?.displayName ??
      leader.paneKey,
    agentType: leader.agentType,
    status: statusOf(condition, leader.state === 'waiting' || ownerAsk !== null, {
      review: null,
      workItem: null
    }),
    condition,
    since: leader.stateSince ?? null,
    liveAction: liveActionOf(leader),
    model: modelOf(leader, state.lead),
    account: accountOf(leader, state),
    characterKey: null,
    branch: state.worktree?.branch ?? null,
    ownerAsk
  }
  const live = state.agents.filter((one) => one.isMember && !one.isLeader)
  const offline = [...(state.pausedMembers ?? []), ...(state.queuedMembers ?? [])]
  const names = memberNamesOf(
    live,
    roster,
    [lead.name, ...offline.flatMap((one) => (one.name ? [one.name] : []))],
    locale
  )
  const members = [
    ...live.map((one, at) => memberCardOf(one, state, questionTickets, roster, names[at] ?? null)),
    ...(state.pausedMembers ?? []).map((one) => offlineCardOf(one, 'paused', roster)),
    ...(state.queuedMembers ?? []).map((one) => offlineCardOf(one, 'queued', roster))
  ]
    .map((card, index) => ({ card, index }))
    .sort((a, b) => STATUS_RANK[a.card.status] - STATUS_RANK[b.card.status] || a.index - b.index)
    .map(({ card }) => card)
  return { lead, members }
}
