import type { CheckStatus } from '../../../src/shared/github/pull-request-types'
import type { HostedReviewState } from '../../../src/shared/hosted-review'
import type {
  GameOwnerQuestion,
  GameOwnerQuestionProject
} from '../../../src/shared/orchestrator-game-owner-questions'
import type { GameAgent } from '../../../src/shared/orchestrator-game-state'
import type { GameCharacterLevel } from '../../../src/shared/orchestrator-game-characters'
import type { GameInboxThreads } from '../../../src/shared/orchestrator-game-inbox-threads'
import type { OwnerQuestionReply } from '../game-inbox/game-owner-questions-rpc'
import { getRepoIdFromWorktreeId } from '../../../src/shared/worktree/id'
import type { TerminalOpenTarget } from '../session/host-terminal-open'
import { teamCardWordsOf, type TeamCardWords } from './team-card-words'
import { teamMemberContextOf } from './team-drawer-member-context'
import type {
  TeamAdvisorRow,
  TeamFlowPhase,
  TeamLeadCard,
  TeamMemberAsk
} from '../../../src/shared/team-panel-model-types'
import { AGENT_STATES, memberRowOf } from './team-member-row'
import { teamLeadCardsOf } from './team-sheet-lead'
import { teamSheetWorkOf, type TeamSheetWork } from './team-sheet-work'
import type { TeamTones } from './team-status-tone'
import { teamSceneBandOf, type TeamSceneBand } from './team-scene-band'
import type { TeamSceneArtLoad } from './use-team-scene-art'
import { teamSheetControlOf, type TeamSheetControl } from './team-sheet-control'
import { teamHeldMemberRowsOf } from './team-held-members'
import type { TeamAction } from '../../../src/shared/team-panel-actions'
import type { TeamTurnResult } from './team-lead-turn-send'
import { normalizeSupportedUiLocale, type SupportedUiLocale } from '../../../src/shared/ui-locale'

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
    ciHistory: { headSha: string; ci: CheckStatus }[]
    comments: number | null
  } | null
  ticketStatus: string | null
  /** The tool or link it is on now; null once it stopped. */
  live: string | null
  /** When its state began, on the host's clock. */
  since: number | null
  phase: TeamFlowPhase | null
  /** Its ticket's last mail subject. */
  summary: string | null
  /** The session tab on this host; null for a member on a paired host. */
  terminal: TerminalOpenTarget | null
  /** `usedPercent` is the 5 h window, `weeklyPercent` the 7 d one. */
  account: { email: string; usedPercent: number | null; weeklyPercent: number | null } | null
  limit: { resetsAt: number | null; loggedOut: boolean } | null
  /** A STOP paused it, or its launch waits in the queue; null for a live session. */
  hold: { kind: 'paused' } | { kind: 'queued'; waitingOn: string } | null
  /** What it waits on the person for, as the desktop card says it (ORCA-1231). */
  ask?: TeamMemberAsk | null
  /** The open PR's CI a stopped member waits on (ORCA-1205). */
  idleCi?: 'failure' | 'pending' | null
}

export type TeamMetrics = {
  latestDay: { day: string; merged: number } | null
  mergedInWindow: number
  windowDays: number
  leadTimeMedianMs: number | null
}

export type TeamLeadView = {
  members: TeamMemberRow[]
  /** null when the host sends no lead agent. */
  lead: TeamLeadCard | null
  /** Jev's card; null without the advisor plugin or from an older host. */
  advisor: TeamAdvisorRow | null
  work: TeamSheetWork
  /** The band above the tabs; null when the desktop panel shows no scene. */
  scene: TeamSceneBand | null
  control: TeamSheetControl
  metrics: TeamMetrics | null
  locale: SupportedUiLocale
}

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
  /** The team's level from its characters' XP; null on a host that does not advertise it. */
  level: GameCharacterLevel | null
  /** The scene file's images for the band; null unless the band draws a scene's own art. */
  sceneArt: TeamSceneArtLoad | null
  /** Sends an action to the lead as a turn; null with no lead terminal to write to. */
  sendAction: ((action: TeamAction) => Promise<TeamTurnResult>) | null
  /** The status colours, with the person's Settings > Agent Teams overrides. */
  tones: TeamTones
}

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null
const STATE_ORDER = new Map(AGENT_STATES.map((state, index) => [state, index]))

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
  questionTickets: ReadonlySet<string> = new Set(),
  ownerAsk: { ticket: string | null } | null = null,
  now: number = Date.now(),
  options: { sceneArt?: boolean } = {}
): TeamLeadView | null {
  // Why `lead`: role is `lead` for any root pane; only a project with a lead has a Team.
  if (!isRecord(raw) || raw.role !== 'lead' || !isRecord(raw.lead) || raw.leadElsewhere) {
    return null
  }
  const agents = Array.isArray(raw.agents) ? raw.agents : []
  const context = teamMemberContextOf(raw, questionTickets)
  const locale = normalizeSupportedUiLocale(text(raw.locale) ?? undefined)
  const { lead, advisor, cards } = teamLeadCardsOf(raw, questionTickets, ownerAsk, locale)
  const cardsByKey = new Map(cards.map((card) => [card.paneKey, card]))
  const members = agents
    .flatMap((one) => (isRecord(one) ? [memberRowOf(one, context, cardsByKey)] : []))
    .filter((one): one is TeamMemberRow => one !== null)
    .map((one, index) => ({ one, index }))
    .sort((a, b) => rank(a.one) - rank(b.one) || a.index - b.index)
    .map(({ one }) => one)
    .concat(teamHeldMemberRowsOf(raw))
  const control = teamSheetControlOf(raw)
  const work = teamSheetWorkOf(raw, cards, locale, now)
  return {
    members,
    lead,
    advisor,
    work,
    scene: teamSceneBandOf(
      raw,
      { lead, members: cards, advisor, stopped: control.stopped !== null },
      { ...options, machines: work.machines }
    ),
    control,
    metrics: metricsOf(raw.metrics),
    locale
  }
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
  questionTickets: readonly string[] = [],
  words: Pick<TeamCardWords, 'needYou' | 'workingOf' | 'noMembers'> = teamCardWordsOf('en')
): TeamPeek {
  const asked = new Set(questionTickets)
  // Why: a waiting member whose ticket already has an open question is that one ask.
  const waiting = view.members.filter(
    (one) => one.state === 'waiting' && !(one.ticket && asked.has(one.ticket))
  ).length
  const need = openQuestions + waiting
  if (need > 0) {
    return { tone: 'question', text: words.needYou(need) }
  }
  const total = view.members.length
  if (total === 0) {
    return { tone: 'idle', text: words.noMembers }
  }
  const working = view.members.filter((one) => one.state === 'working').length
  return {
    tone: working > 0 ? 'working' : 'idle',
    text: words.workingOf(working, total)
  }
}

/** Time in state, as the desktop card words it: `now`, `10 min`, `13 h`, `3 d`. */
export function teamAgeText(since: number, now: number, nowWord = 'now'): string {
  const minutes = Math.floor((now - since) / 60_000)
  if (minutes < 1) {
    return nowWord
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
