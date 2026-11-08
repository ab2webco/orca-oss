import type { CheckStatus } from '../../../src/shared/github/pull-request-types'
import type { HostedReviewState } from '../../../src/shared/hosted-review'
import type {
  GameOwnerQuestion,
  GameOwnerQuestionProject
} from '../../../src/shared/orchestrator-game-owner-questions'
import type { GameAgent } from '../../../src/shared/orchestrator-game-state'
import type { GameInboxThreads } from '../../../src/shared/orchestrator-game-inbox-threads'
import type { OwnerQuestionReply } from '../game-inbox/game-owner-questions-rpc'
import { ticketInText } from '../../../src/shared/orchestrator-game-ticket-id'
import { agentToolLabelOf } from '../../../src/shared/agent-tool-label'
import { isAskUserQuestionTool } from '../../../src/shared/agent-question-answered-intent'
import { getRepoIdFromWorktreeId } from '../../../src/shared/worktree/id'

export type TeamMemberRow = {
  key: string
  name: string
  ticket: string | null
  title: string | null
  state: GameAgent['state']
  /** Waiting on input, or its ticket has an open owner question. */
  needsYou: boolean
  /** The paired host it runs on; null on this host. */
  host: string | null
  agent: string | null
  model: string | null
  pr: {
    number: number
    url: string
    state: HostedReviewState
    ci: CheckStatus | 'none'
    /** CI per pushed head, oldest first; empty from an older host. */
    ciHistory: CheckStatus[]
    comments: number | null
  } | null
  ticketStatus: string | null
  /** The tool or link it is on now; null once it stopped. */
  live: string | null
  /** When its state began, on the host's clock. */
  since: number | null
  account: { email: string; usedPercent: number | null } | null
  limit: { resetsAt: number | null; loggedOut: boolean } | null
}

export type TeamMetrics = {
  latestDay: { day: string; merged: number } | null
  mergedInWindow: number
  windowDays: number
  leadTimeMedianMs: number | null
}

export type TeamLeadView = { members: TeamMemberRow[]; metrics: TeamMetrics | null }

/** `unavailable`: the host's phone allowlist predates the Inbox tab. */
export type TeamInbox =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; threads: GameInboxThreads }

export type TeamDrawerData = {
  /** null: this terminal is not a live lead, or the host cannot say. */
  view: TeamLeadView | null
  questions: GameOwnerQuestion[]
  /** The worktree the owner board answers through; null when the host has none for this repo. */
  answerWorktreeId: string | null
  inbox: TeamInbox
  answer: (id: string, reply: OwnerQuestionReply) => Promise<void>
}

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null
const AGENT_STATES: readonly GameAgent['state'][] = ['waiting', 'working', 'idle', 'done']
const STATE_ORDER = new Map(AGENT_STATES.map((state, index) => [state, index]))

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
      isRecord(head) && text(head.ci) ? [head.ci as CheckStatus] : []
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

function accountUsageOf(metrics: unknown): Map<string, number> {
  const accounts =
    isRecord(metrics) && Array.isArray(metrics.claudeAccounts) ? metrics.claudeAccounts : []
  return new Map(
    accounts.flatMap((one) =>
      isRecord(one) && text(one.email) && typeof one.sessionPercent === 'number'
        ? [[one.email as string, one.sessionPercent] as const]
        : []
    )
  )
}

function modelOf(launch: unknown): string | null {
  const model = isRecord(launch) ? text(launch.model) : null
  const effort = model && isRecord(launch) ? text(launch.effort) : null
  return effort ? `${model} · ${effort}` : model
}

function memberRowOf(
  raw: Rec,
  questionTickets: ReadonlySet<string>,
  usage: ReadonlyMap<string, number>
): TeamMemberRow | null {
  const key = text(raw.paneKey)
  if (!key || raw.isMember !== true) {
    return null
  }
  const state = AGENT_STATES.find((one) => one === raw.state) ?? 'idle'
  const item = isRecord(raw.workItem) && text(raw.workItem.identifier) ? raw.workItem : null
  const worktree = isRecord(raw.worktree) ? raw.worktree : {}
  const name = text(raw.displayName) ?? text(worktree.displayName) ?? key
  const ticket = item
    ? (item.identifier as string).toUpperCase()
    : (ticketInText(name) ?? ticketInText(text(worktree.branch)))
  const remote = isRecord(raw.remote) ? raw.remote : null
  const email = isRecord(raw.account) ? text(raw.account.email) : null
  return {
    key,
    name,
    ticket,
    title: item ? text(item.title) : null,
    state,
    needsYou: state === 'waiting' || (ticket !== null && questionTickets.has(ticket)),
    host: remote ? text(remote.host) : null,
    agent: text(raw.agentType),
    model: modelOf(raw.launch),
    pr: prOf(raw.review),
    ticketStatus: item
      ? (text(item.status) ?? text(item.statusGroup))
      : remote?.ticketDone === true
        ? 'done'
        : null,
    live: liveOf(raw, state),
    since: num(raw.stateSince),
    account: email ? { email, usedPercent: usage.get(email) ?? null } : null,
    limit: isRecord(raw.limit)
      ? { resetsAt: num(raw.limit.resetsAt), loggedOut: raw.limit.loggedOut === true }
      : null
  }
}

function metricsOf(raw: unknown): TeamMetrics | null {
  if (!isRecord(raw) || !Array.isArray(raw.mergedPerDay)) {
    return null
  }
  const days = raw.mergedPerDay.filter(
    (one): one is { day: string; merged: number } =>
      isRecord(one) && typeof one.day === 'string' && typeof one.merged === 'number'
  )
  const latest = days.at(-1)
  const median = isRecord(raw.leadTime) ? raw.leadTime.medianMs : null
  return {
    latestDay: latest ? { day: latest.day, merged: latest.merged } : null,
    mergedInWindow: days.reduce((sum, one) => sum + one.merged, 0),
    windowDays: days.length,
    leadTimeMedianMs: typeof median === 'number' ? median : null
  }
}

// Why a non-waiting needs-you row first: only an open owner question puts it there.
const rank = (row: TeamMemberRow): number =>
  row.needsYou ? (row.state === 'waiting' ? 1 : 0) : 2 + (STATE_ORDER.get(row.state) ?? 9)

/** The lead's Team, or null when this pane is not the live lead of a game project. */
export function teamLeadViewOf(
  raw: unknown,
  questionTickets: ReadonlySet<string> = new Set()
): TeamLeadView | null {
  // Why `lead`: role is `lead` for any root pane; only a project with a lead has a Team.
  if (!isRecord(raw) || raw.role !== 'lead' || !isRecord(raw.lead) || raw.leadElsewhere) {
    return null
  }
  const agents = Array.isArray(raw.agents) ? raw.agents : []
  const usage = accountUsageOf(raw.metrics)
  const members = agents
    .flatMap((one) => (isRecord(one) ? [memberRowOf(one, questionTickets, usage)] : []))
    .filter((one): one is TeamMemberRow => one !== null)
    .map((one, index) => ({ one, index }))
    .sort((a, b) => rank(a.one) - rank(b.one) || a.index - b.index)
    .map(({ one }) => one)
  return { members, metrics: metricsOf(raw.metrics) }
}

/** The owner board is per repo, so the lead's questions are its own repo's. */
export function leadOwnerQuestionsOf(
  projects: readonly GameOwnerQuestionProject[],
  leadWorktreeId: string
): { worktreeId: string | null; questions: GameOwnerQuestion[] } {
  const repoId = getRepoIdFromWorktreeId(leadWorktreeId)
  const project = projects.find((one) => one.repoId === repoId)
  return project
    ? { worktreeId: project.worktreeId, questions: project.questions }
    : { worktreeId: null, questions: [] }
}

export type TeamPeek = { tone: 'question' | 'working' | 'idle'; text: string }

/** The sheet's collapsed line: who needs you, else who works. */
export function teamPeekOf(
  view: TeamLeadView,
  openQuestions: number,
  questionTickets: readonly string[] = []
): TeamPeek {
  const asked = new Set(questionTickets)
  // Why: a waiting member whose ticket already has an open question is that one ask.
  const waiting = view.members.filter(
    (one) => one.state === 'waiting' && !(one.ticket && asked.has(one.ticket))
  ).length
  const need = openQuestions + waiting
  if (need > 0) {
    return { tone: 'question', text: `${need} ${need === 1 ? 'needs' : 'need'} you` }
  }
  const total = view.members.length
  if (total === 0) {
    return { tone: 'idle', text: 'No members running' }
  }
  const working = view.members.filter((one) => one.state === 'working').length
  return {
    tone: working > 0 ? 'working' : 'idle',
    text: `${working} working · ${total} member${total === 1 ? '' : 's'}`
  }
}

/** Time in state, as the desktop card words it: `now`, `10 min`, `13 h`, `3 d`. */
export function teamAgeText(since: number, now: number): string {
  const minutes = Math.floor((now - since) / 60_000)
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}

export function formatLeadTime(ms: number): string {
  const hours = ms / 3_600_000
  if (hours < 1) {
    return `${Math.max(1, Math.round(ms / 60_000))} min`
  }
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`
}
