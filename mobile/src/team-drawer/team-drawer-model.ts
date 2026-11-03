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
  pr: { number: number; url: string; state: HostedReviewState; ci: CheckStatus | 'none' } | null
  ticketStatus: string | null
}

export type TeamMetrics = {
  latestDay: { day: string; merged: number } | null
  mergedInWindow: number
  windowDays: number
  leadTimeMedianMs: number | null
}

export type TeamLeadView = { members: TeamMemberRow[]; metrics: TeamMetrics | null }

export type TeamBadge = { tone: 'question' | 'working'; count: number } | null

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
  badge: TeamBadge
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

function prOf(raw: unknown): TeamMemberRow['pr'] {
  if (!isRecord(raw) || typeof raw.number !== 'number' || !text(raw.url)) {
    return null
  }
  return {
    number: raw.number,
    url: raw.url as string,
    state: (text(raw.state) ?? 'open') as HostedReviewState,
    ci: (text(raw.ci) ?? 'none') as CheckStatus | 'none'
  }
}

function memberRowOf(raw: Rec, questionTickets: ReadonlySet<string>): TeamMemberRow | null {
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
  return {
    key,
    name,
    ticket,
    title: item ? text(item.title) : null,
    state,
    needsYou: state === 'waiting' || (ticket !== null && questionTickets.has(ticket)),
    host: remote ? text(remote.host) : null,
    agent: text(raw.agentType),
    model: isRecord(raw.launch) ? text(raw.launch.model) : null,
    pr: prOf(raw.review),
    ticketStatus: item
      ? (text(item.status) ?? text(item.statusGroup))
      : remote?.ticketDone === true
        ? 'done'
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
  const members = agents
    .flatMap((one) => (isRecord(one) ? [memberRowOf(one, questionTickets)] : []))
    .filter((one): one is TeamMemberRow => one !== null)
    .map((one, index) => ({ one, index }))
    .sort((a, b) => rank(a.one) - rank(b.one) || a.index - b.index)
    .map(({ one }) => one)
  return { members, metrics: metricsOf(raw.metrics) }
}

export function teamBadgeOf(openQuestions: number, members: readonly TeamMemberRow[]): TeamBadge {
  if (openQuestions > 0) {
    return { tone: 'question', count: openQuestions }
  }
  const working = members.filter((one) => one.state === 'working').length
  return working > 0 ? { tone: 'working', count: working } : null
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

export function teamButtonLabel(badge: TeamBadge): string {
  if (!badge) {
    return 'Open Team'
  }
  const plural = badge.count === 1 ? '' : 's'
  return badge.tone === 'question'
    ? `Open Team, ${badge.count} question${plural} waiting`
    : `Open Team, ${badge.count} member${plural} working`
}

export function formatLeadTime(ms: number): string {
  const hours = ms / 3_600_000
  if (hours < 1) {
    return `${Math.max(1, Math.round(ms / 60_000))} min`
  }
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`
}
