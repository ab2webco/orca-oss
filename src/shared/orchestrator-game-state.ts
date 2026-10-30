import type { AgentStatusState } from './agent-status-types'
import type { CheckStatus, PRReviewDecision } from './github/pull-request-types'
import type { HostedReviewProvider, HostedReviewState } from './hosted-review'
import type { OrchestratorGameConfig, OrchestratorGameSource } from './orchestrator-game-config'
import type { OrchestratorGameViewId, OrchestratorGameViewScope } from './orchestrator-game-view'
import type { GameAction } from './orchestrator-game-actions'
import type { OrchestratorGameLead } from './orchestrator-game-lead'
import type { GameRewardWeights } from './orchestrator-game-reward-weights'
import type { GameProjectWork } from './orchestrator-game-project-work'
import type { OrchestratorGameSceneExtension } from './orchestrator-game-scene'
import type { RuntimeWorktreeAgentRow } from './runtime-types'
import type { GameStop } from './orchestrator-game-stop-state'
import type { GameInboxSummary } from './orchestrator-game-inbox'
import type { GameMemberAdvisor } from './orchestrator-game-member-advisor'
import type { SupportedUiLocale } from './ui-locale'
import type { GameMemberLaunch } from './orchestrator-game-member-launch'
import type {
  GamePausedMember,
  GameQueuedMember,
  GameUnlistedMember
} from './orchestrator-game-member-sessions'

export type GameStatusGroup =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'unknown'

/** The latest id an agent's MCP calls mentioned that a rule turned into a link. */
export type GameActivity = {
  name: string
  id: string
  url: string
  at: number
  /** True between the tool's PreToolUse and PostToolUse. */
  running: boolean
}

export type GameAgent = {
  paneKey: string
  displayName: string | null
  agentType: string | null
  state: 'working' | 'waiting' | 'idle' | 'done'
  toolName: string | null
  isLeader: boolean
  /** Optional on the wire: older hosts send none, and a pane with no terminal gets none. */
  terminalHandle?: string
  /** Optional on the wire: older hosts send none, and an agent no rule matched gets none. */
  activity?: GameActivity
  /** A session the lead launched through `orca orchestration`, which reports to it. */
  isMember?: boolean
  /** The member's own worktree, when it is not the lead's. */
  worktree?: GameMemberWorktree
  /** The member worktree's own review and ticket; the lead's worktree's are the state's. */
  review?: GameReview
  workItem?: GameWorkItem
  /** The managed account a member's agent runs on; absent when Orca cannot tell or from an older host. */
  account?: GameMemberAccount
  /** Set while a member is stopped by its account's usage limit; absent from an older host. */
  limit?: { resetsAt: number | null }
  /** What Jev in the member's own pane has it on; absent without Jev there or from an older host. */
  advisor?: GameMemberAdvisor
  /** The model and effort Orca dispatched the member on; absent when it chose neither or from an older host. */
  launch?: GameMemberLaunch
  /** When the host last saw the member's terminal work (ORCA-746); absent when unknown or from an older host. */
  lastActivityAt?: string
  /** When the member's current agent state began, on its host's clock (ms); absent from an older host. */
  stateSince?: number
  /** Failed for silence yet still working, not reopened because something replaced it (ORCA-658). */
  orphaned?: true
  /** A member running on a paired remote host; `stateKnown` is false while that host does not answer (ORCA-824). */
  remote?: GameRemoteHost
}

export type GameRemoteHost = {
  host: string
  stateKnown: boolean
  /** Launched by a lead that no longer leads it; read from the home Run DB (ORCA-793). */
  earlierLead?: true
  /** The home Run completed the member's task. */
  ticketDone?: true
  /** The host answered and the member's terminal is no longer there (ORCA-790). */
  gone?: true
}

export type GameMemberAccount = { provider: 'claude' | 'codex'; id: string; email: string }

export type GameMemberWorktree = { id: string; branch: string; displayName: string }

export type GameReviewVerdict = 'approved' | 'changes_requested' | 'review_required'

export type GameReview = {
  provider: Exclude<HostedReviewProvider, 'unsupported'>
  number: number
  title: string
  url: string
  state: HostedReviewState
  ci: CheckStatus | 'none'
  /** The host's review decision; absent without one (GitLab) or from an older host (ORCA-686). */
  verdict?: GameReviewVerdict
  /** CI per pushed head, oldest first; these three are read together, GitHub only. */
  ciHistory?: GameReviewHeadCi[]
  /** Review comment threads on the PR. */
  commentCount?: number
  /** Times the PR was reopened. */
  reopenCount?: number
  /** Set once merged with every fact read: no red head, CI green, nothing to fix, never reopened. */
  perfectMerge?: boolean
}

export type GameReviewHeadCi = { headSha: string; ci: CheckStatus }

type GameReviewFacts = Pick<Required<GameReview>, 'ciHistory' | 'commentCount' | 'reopenCount'>

// Why: the lead merges only after checking acceptance, so a merge stands for "acceptance met".
const isPerfectMerge = (review: GameReview, facts: GameReviewFacts): boolean =>
  review.ci === 'success' &&
  review.verdict !== 'changes_requested' &&
  facts.commentCount === 0 &&
  facts.reopenCount === 0 &&
  facts.ciHistory.every((head) => head.ci !== 'failure')

const REVIEW_VERDICT: Record<PRReviewDecision, GameReviewVerdict> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'review_required'
}

export type GameWorkItem = {
  provider: 'plane' | 'jira' | 'linear' | 'github' | 'gitlab'
  identifier: string
  title: string
  url: string
  status: string
  statusGroup: GameStatusGroup
}

export type GameLinkKind = 'review' | 'ci' | 'workItem' | 'project' | 'activity'

export type GameLinkTone = 'neutral' | 'pending' | 'success' | 'danger'

/** A clickable integration of the worktree; `url` is always http(s). */
export type GameLink = {
  id: string
  kind: GameLinkKind
  provider: string
  label: string
  url: string
  status?: string
  tone?: GameLinkTone
}

export type OrchestratorGameState = {
  config: OrchestratorGameConfig
  sources: Record<keyof OrchestratorGameConfig, OrchestratorGameSource>
  warnings: string[]
  worktree: { id: string; path: string; branch: string; displayName: string } | null
  agents: GameAgent[]
  review: GameReview | null
  workItem: GameWorkItem | null
  /** The scopes `orca game view` can store a view in for this pane; absent from an older host. */
  viewScopes?: OrchestratorGameViewScope[]
  /** The view this host's resources suggest; absent from an older host or with no reading. */
  suggestedView?: OrchestratorGameViewId
  /** Optional on the wire: a host older than plugin scenes sends none. */
  extensions?: { scenes: OrchestratorGameSceneExtension[] }
  /** Optional on the wire: a host older than game links sends none. */
  links?: GameLink[]
  /** The calling pane's own activity; optional on the wire like `links`. */
  activity?: GameActivity
  /** My open PRs and tickets across the project; absent with the tracker off or from an older host. */
  project?: GameProjectWork
  /** The project's buttons, filled for this worktree; absent when it declares none. */
  actions?: GameAction[]
  /** How this project's lead orchestrates; absent from an older host. */
  lead?: OrchestratorGameLead
  /** XP per reward after every layer; absent from an older host, whose mod uses the baseline. */
  rewardWeights?: GameRewardWeights
  /** Whether the calling pane leads or was launched by a lead; absent from an older host. */
  role?: 'lead' | 'member'
  /** The project's live lead when it is another pane; absent when this pane is it, or none is live. */
  leadElsewhere?: { handle: string }
  /** The project's persistent STOP, null when clear; absent from a host older than it. */
  stopped?: GameStop | null
  /** The lead's inbox first, then each ticket's, with unread counts; only for the lead, absent from an older host. */
  inboxes?: GameInboxSummary[]
  /** Questions the lead asked the person (`game ask-owner`) still unanswered; only for the lead, absent from an older host. */
  openOwnerQuestions?: number
  /** Members this project had live that are not now (Orca or the machine restarted); only for the lead, absent from an older host. */
  pausedMembers?: GamePausedMember[]
  /** Members whose start waits for the setup in flight; only for the lead, absent from an older host. */
  queuedMembers?: GameQueuedMember[]
  /** Saved members whose worktree runs an agent this lead does not list; only for the lead, when any. */
  unlistedMembers?: GameUnlistedMember[]
  /** Why the saved members could not be read or saved; absent when they could. */
  pausedMembersError?: string
  /** Orca's UI language now, so a running pane follows a change; absent from an older host. */
  locale?: SupportedUiLocale
}

const REVIEW_NAME = /review|qa|testing|verify/i

export function statusGroupOfPlane(group: string, name: string): GameStatusGroup {
  switch (group) {
    case 'backlog':
      return 'backlog'
    case 'unstarted':
      return 'todo'
    case 'started':
      return REVIEW_NAME.test(name) ? 'review' : 'in_progress'
    case 'completed':
      return 'done'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

// Why: Linear, Jira and issue trackers expose free-form state names to the agent surface.
const NAME_GROUPS: readonly [RegExp, GameStatusGroup][] = [
  [/cancel|won.?t|duplicate/i, 'cancelled'],
  [/done|closed|complete|resolved|merged/i, 'done'],
  [REVIEW_NAME, 'review'],
  [/progress|doing|started|active/i, 'in_progress'],
  [/backlog|icebox/i, 'backlog'],
  [/to.?do|open|unstarted|ready|new/i, 'todo']
]

export function statusGroupOfName(name: string): GameStatusGroup {
  return NAME_GROUPS.find(([pattern]) => pattern.test(name))?.[1] ?? 'unknown'
}

// Why: Jira's category is reliable for todo/doing/done; the name is still needed for review and cancelled.
export function statusGroupOfJira(categoryKey: string, name: string): GameStatusGroup {
  const named = statusGroupOfName(name)
  switch (categoryKey) {
    case 'new':
      return named === 'backlog' ? 'backlog' : 'todo'
    case 'indeterminate':
      return named === 'review' ? 'review' : 'in_progress'
    case 'done':
      return named === 'cancelled' ? 'cancelled' : 'done'
    default:
      return named
  }
}

const AGENT_STATES: Record<AgentStatusState, GameAgent['state']> = {
  working: 'working',
  blocked: 'waiting',
  waiting: 'waiting',
  done: 'done'
}

export const gameAgentStateOf = (state: AgentStatusState): GameAgent['state'] =>
  AGENT_STATES[state] ?? 'idle'

export function gameAgentOf(
  row: Pick<
    RuntimeWorktreeAgentRow,
    'paneKey' | 'state' | 'agentType' | 'displayName' | 'taskTitle' | 'toolName'
  >,
  leaderPaneKey: string | null,
  terminalHandle: string | null = null
): GameAgent {
  return {
    paneKey: row.paneKey,
    displayName: row.displayName ?? row.taskTitle,
    agentType: row.agentType,
    state: gameAgentStateOf(row.state),
    toolName: row.toolName,
    isLeader: row.paneKey === leaderPaneKey,
    ...(terminalHandle ? { terminalHandle } : {})
  }
}

export function gameReviewOf(
  review: {
    provider: HostedReviewProvider
    number: number
    title: string
    url: string
    state: HostedReviewState
    status: CheckStatus
    reviewDecision?: PRReviewDecision | null
    ciHistory?: readonly GameReviewHeadCi[]
    commentCount?: number
    reopenCount?: number
  } | null
): GameReview | null {
  if (!review || review.provider === 'unsupported') {
    return null
  }
  const out: GameReview = {
    provider: review.provider,
    number: review.number,
    title: review.title,
    url: review.url,
    state: review.state,
    ci: review.status,
    ...(review.reviewDecision ? { verdict: REVIEW_VERDICT[review.reviewDecision] } : {})
  }
  const { ciHistory, commentCount, reopenCount } = review
  if (ciHistory === undefined || commentCount === undefined || reopenCount === undefined) {
    return out
  }
  const facts = { ciHistory: [...ciHistory], commentCount, reopenCount }
  return {
    ...out,
    ...facts,
    ...(review.state === 'merged' ? { perfectMerge: isPerfectMerge(out, facts) } : {})
  }
}
