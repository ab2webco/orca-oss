import type { GameAgent } from '../../../src/shared/orchestrator-game-state'
import { ticketInText } from '../../../src/shared/orchestrator-game-ticket-id'
import { agentToolLabelOf } from '../../../src/shared/agent-tool-label'
import { isAskUserQuestionTool } from '../../../src/shared/agent-question-answered-intent'
import { teamFlowPhaseOf } from '../../../src/shared/team-flow-phase'
import { memberAskOf, teamIdleCiOf } from '../../../src/shared/team-member-shown-state'
import { memberTicketStatusOf } from '../../../src/shared/orchestrator-game-member-next'
import type { CheckStatus } from '../../../src/shared/github/pull-request-types'
import type { HostedReviewState } from '../../../src/shared/hosted-review'
import type { TeamMemberCard } from '../../../src/shared/team-panel-model-types'
import type { TeamMemberContext } from './team-drawer-member-context'
import type { TeamMemberRow } from './team-drawer-model'

// Why a module: one member's row from the lead's game.state, kept apart so the model stays under the line cap.

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

export const AGENT_STATES: readonly GameAgent['state'][] = ['waiting', 'working', 'idle', 'done']

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)

function prOf(raw: unknown): TeamMemberRow['pr'] {
  if (!isRecord(raw) || typeof raw.number !== 'number' || !text(raw.url)) {
    return null
  }
  const heads = Array.isArray(raw.ciHistory) ? raw.ciHistory : []
  return {
    number: raw.number,
    url: raw.url as string,
    state: (text(raw.state) ?? 'open') as HostedReviewState,
    ci: (text(raw.ci) ?? 'none') as CheckStatus | 'none',
    ciHistory: heads.flatMap((head) =>
      isRecord(head) && text(head.ci) && text(head.headSha)
        ? [{ headSha: head.headSha as string, ci: head.ci as CheckStatus }]
        : []
    ),
    comments: num(raw.commentCount)
  }
}

// Why: a worker's Bash line carries its dispatch capability, a bearer secret no card may show.
const DISPATCH_CAPABILITY = /dcap_[A-Za-z0-9_-]+/g

// Why only working or waiting: an agent keeps its last tool after it stops.
function liveOf(raw: Rec, state: GameAgent['state']): string | null {
  if (state !== 'working' && state !== 'waiting') {
    return null
  }
  const activity = isRecord(raw.activity) ? raw.activity : null
  if (activity?.running === true && text(activity.name) && text(activity.id)) {
    return `${activity.name as string} · ${activity.id as string}`
  }
  const tool = text(raw.toolName)
  if (!tool || isAskUserQuestionTool(tool)) {
    return null
  }
  const input = text(raw.toolInput)?.replace(DISPATCH_CAPABILITY, '[redacted]')
  return input ? `${agentToolLabelOf(tool)} · ${input}` : agentToolLabelOf(tool)
}

// Why the desktop rule (ORCA-1401): a completed home Run is not done while its PR is open or queued.
function remoteTicketStatusOf(
  raw: Rec,
  pr: TeamMemberRow['pr'],
  mergeQueued: ReadonlySet<string>
): string | null {
  const chosenBy =
    isRecord(raw.launch) && isRecord(raw.launch.chosenBy) ? raw.launch.chosenBy : null
  const kind = chosenBy ? text(chosenBy.kind) : null
  return memberTicketStatusOf(
    {
      displayName: text(raw.displayName) ?? undefined,
      remote: { ticketDone: true },
      review: pr ? { number: pr.number, url: pr.url, state: pr.state } : undefined,
      launch: kind ? { chosenBy: { kind } } : undefined
    } as GameAgent,
    mergeQueued
  )
}

function modelOf(launch: unknown): string | null {
  const model = isRecord(launch) ? text(launch.model) : null
  const effort = model && isRecord(launch) ? text(launch.effort) : null
  return effort ? `${model} · ${effort}` : model
}

// Why the desktop card: the phone must read the same derived state, not the raw hook state (ORCA-1205).
export function memberRowOf(
  raw: Rec,
  context: TeamMemberContext,
  cards: ReadonlyMap<string, TeamMemberCard>
): TeamMemberRow | null {
  const { questionTickets, usage } = context
  const key = text(raw.paneKey)
  if (!key || raw.isMember !== true) {
    return null
  }
  const card = cards.get(key)
  const hooked = AGENT_STATES.find((one) => one === raw.state) ?? 'idle'
  const state = hooked === 'done' && card?.condition === 'idle' ? 'idle' : hooked
  const item = isRecord(raw.workItem) && text(raw.workItem.identifier) ? raw.workItem : null
  const worktree = isRecord(raw.worktree) ? raw.worktree : {}
  const paneName = text(raw.displayName) ?? text(worktree.displayName) ?? key
  const ticket = item
    ? (item.identifier as string).toUpperCase()
    : (ticketInText(paneName) ?? ticketInText(text(worktree.branch)))
  // Why the card's name: the pane's display name carries the ticket the card already shows.
  const name = card?.name ?? paneName
  const remote = isRecord(raw.remote) ? raw.remote : null
  const ask = memberAskOf(
    { state, toolName: text(raw.toolName), limit: raw.limit } as GameAgent,
    ticket !== null && questionTickets.has(ticket)
  )
  const email = isRecord(raw.account) ? text(raw.account.email) : null
  const used = email ? usage.get(email) : undefined
  const review = isRecord(raw.review) ? raw.review : null
  const pr = prOf(raw.review)
  return {
    key,
    name,
    ticket,
    title: item ? text(item.title) : null,
    state,
    needsYou: ask !== null || state === 'waiting',
    ask,
    idleCi: card ? teamIdleCiOf(card) : null,
    host: remote ? text(remote.host) : null,
    agent: text(raw.agentType),
    model: modelOf(raw.launch),
    pr,
    ticketStatus: item
      ? (text(item.status) ?? text(item.statusGroup))
      : remote?.ticketDone === true
        ? remoteTicketStatusOf(raw, pr, context.mergeQueued)
        : null,
    live: liveOf(raw, state),
    since: num(raw.stateSince),
    phase: teamFlowPhaseOf({
      state,
      toolName: text(raw.toolName),
      toolInput: text(raw.toolInput),
      review: review && text(review.state) ? { state: review.state as string } : null,
      workItem: item ? { statusGroup: text(item.statusGroup) } : null
    }),
    summary: ticket ? (context.summaries.get(ticket) ?? null) : null,
    terminal: context.terminalOf(raw, key),
    account: email
      ? { email, usedPercent: used?.session ?? null, weeklyPercent: used?.weekly ?? null }
      : null,
    limit: isRecord(raw.limit)
      ? { resetsAt: num(raw.limit.resetsAt), loggedOut: raw.limit.loggedOut === true }
      : null,
    hold: null
  }
}
