// Projects dashboard cards + session-log readings into per-project grid cells.
// The log is preferred; the hook-derived card fields are the fallback so a cell
// whose transcript Orca cannot read still says something (ORCA-234).

import type {
  AgentSessionLogPaneReading,
  AgentSessionLogState,
  AgentSessionLogUnreadReason
} from '../../../../shared/agent-session-log-state'
import {
  dashboardCardDisplayState,
  type DashboardCard
} from '../../../../shared/dashboard-snapshot'
import type { AgentDotState } from '@/components/AgentStateDot'

export type AgentGridActivitySource = 'session-log' | 'hook' | 'none'

export type AgentGridCellModel = {
  card: DashboardCard
  /** Null when the log could not be read; `unreadReason` then says why. */
  logState: AgentSessionLogState | null
  dotState: AgentDotState
  /** The line the cell shows: assistant prose, or the hook fallback. */
  activityText: string | null
  /** Tool with no result behind it yet. */
  pendingToolName: string | null
  activitySource: AgentGridActivitySource
  unreadReason: AgentSessionLogUnreadReason | null
  /** Prose exists but sits beyond the activity budget — not "it said nothing". */
  textBeyondScan: boolean
  queuedInput: number
  /** Newest turn boundary from the log, else the card's own timestamp. */
  activeSinceMs: number
}

export type AgentGridProject = {
  repoId: string
  repoName: string
  cells: AgentGridCellModel[]
}

/** Cells the coordinator must look at come first; settled work sinks. */
const DOT_STATE_RANK: Record<AgentDotState, number> = {
  blocked: 0,
  permission: 0,
  waiting: 1,
  working: 2,
  interrupted: 3,
  failed: 3,
  done: 4,
  idle: 5
}

export function agentGridDotState(
  logState: AgentSessionLogState | null,
  card: DashboardCard
): AgentDotState {
  const hookState = dashboardCardDisplayState(card)
  if (logState === null) {
    return hookState
  }
  // Why the hook still wins here: 'blocked' is a permission prompt, which the
  // transcript does not record — the log only knows the turn is still open.
  if (logState === 'working' || logState === 'queued-input') {
    return hookState === 'blocked' ? 'blocked' : 'working'
  }
  if (logState === 'no-activity') {
    return 'idle'
  }
  return hookState === 'blocked' || hookState === 'waiting' ? hookState : 'done'
}

export function buildAgentGridCell(
  card: DashboardCard,
  reading: AgentSessionLogPaneReading | undefined
): AgentGridCellModel {
  const session = reading?.session
  const logState = session?.read === true ? session.state : null
  const activity = session?.read === true ? session.activity : undefined
  const logText = activity?.lastAssistantText ?? null
  const hookText = card.askSummary ?? card.lastAgentMessage ?? card.task ?? null
  const activityText = logText ?? hookText ?? null
  return {
    card,
    logState,
    dotState: agentGridDotState(logState, card),
    activityText,
    pendingToolName: activity?.pendingToolName ?? null,
    activitySource: logText ? 'session-log' : activityText ? 'hook' : 'none',
    unreadReason: session?.read === false ? session.reason : null,
    textBeyondScan: activity?.textBeyondScan ?? false,
    queuedInput:
      session?.read === true && session.queuedInput.supported ? session.queuedInput.pending : 0,
    activeSinceMs:
      (session?.read === true ? session.lastTurnAtMs : null) ??
      card.finishedAt ??
      card.stateChangedAt ??
      card.startedAt
  }
}

export function buildAgentGrid(
  cards: readonly DashboardCard[],
  readingsByPaneKey: ReadonlyMap<string, AgentSessionLogPaneReading>
): AgentGridProject[] {
  const projects = new Map<string, AgentGridProject>()
  for (const card of cards) {
    const project = projects.get(card.repoId) ?? {
      repoId: card.repoId,
      repoName: card.repoName,
      cells: []
    }
    project.cells.push(buildAgentGridCell(card, readingsByPaneKey.get(card.paneKey)))
    projects.set(card.repoId, project)
  }
  for (const project of projects.values()) {
    project.cells.sort(compareCells)
  }
  return [...projects.values()].sort(
    (a, b) => a.repoName.localeCompare(b.repoName) || a.repoId.localeCompare(b.repoId)
  )
}

function compareCells(a: AgentGridCellModel, b: AgentGridCellModel): number {
  const rank = DOT_STATE_RANK[a.dotState] - DOT_STATE_RANK[b.dotState]
  if (rank !== 0) {
    return rank
  }
  const recency = b.activeSinceMs - a.activeSinceMs
  return recency !== 0 ? recency : a.card.paneKey.localeCompare(b.card.paneKey)
}
