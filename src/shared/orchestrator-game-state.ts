import type { AgentStatusState } from './agent-status-types'
import type { CheckStatus } from './github/pull-request-types'
import type { HostedReviewProvider, HostedReviewState } from './hosted-review'
import type { OrchestratorGameConfig, OrchestratorGameSource } from './orchestrator-game-config'
import type { GameAction } from './orchestrator-game-actions'
import type { GameProjectWork } from './orchestrator-game-project-work'
import type { OrchestratorGameSceneExtension } from './orchestrator-game-scene'
import type { RuntimeWorktreeAgentRow } from './runtime-types'

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
}

export type GameMemberWorktree = { id: string; branch: string; displayName: string }

export type GameReview = {
  provider: Exclude<HostedReviewProvider, 'unsupported'>
  number: number
  title: string
  url: string
  state: HostedReviewState
  ci: CheckStatus | 'none'
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
    state: AGENT_STATES[row.state] ?? 'idle',
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
  } | null
): GameReview | null {
  if (!review || review.provider === 'unsupported') {
    return null
  }
  return {
    provider: review.provider,
    number: review.number,
    title: review.title,
    url: review.url,
    state: review.state,
    ci: review.status
  }
}
