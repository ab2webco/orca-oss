import type { AgentStatusEntry } from './agent-status-types'
import { parseAskFromStatus } from './native-chat-ask'
import { gameMemberLaunchOf } from './orchestrator-game-member-launch'
import type {
  TeamAccount,
  TeamActivityRow,
  TeamAdvisorRow,
  TeamCondition,
  TeamHost,
  TeamLiveAction,
  TeamModel,
  TeamPanelSoloModel,
  TeamPanelTabs,
  TeamPullRequest,
  TeamStatus,
  TeamTicket
} from './team-panel-model-types'

/** One agent session with the worktree facts the sidebar already holds for it. */
export type TeamSoloSession = {
  entry: AgentStatusEntry
  repoName: string
  worktreeName: string
  worktreeId: string | null
  isPrimary: boolean
  host: TeamHost
  ticket: TeamTicket | null
  pr: TeamPullRequest | null
  note: string | null
  ports: number[]
  account: TeamAccount | null
  cacheExpiresAt: number | null
  advisor: TeamAdvisorRow | null
}

const STATUS_RANK: Record<TeamStatus, number> = {
  attention: 0,
  risk: 1,
  working: 2,
  done: 3,
  idle: 4
}

// Why: an interrupted turn or a session boundary is not work that finished.
const conditionOf = (entry: AgentStatusEntry): TeamCondition => {
  if (entry.state === 'done') {
    return entry.interrupted || entry.sessionBoundary ? 'idle' : 'done'
  }
  return entry.state === 'working' ? 'working' : 'waiting'
}

const STATUS_OF: Partial<Record<TeamCondition, TeamStatus>> = {
  waiting: 'attention',
  working: 'working',
  done: 'done'
}

const liveActionOf = (entry: AgentStatusEntry, condition: TeamCondition): TeamLiveAction | null => {
  const ask = parseAskFromStatus(entry.interactivePrompt, entry.toolName)?.questions[0]
  if (ask) {
    return {
      kind: 'question',
      text: ask.question,
      options: ask.options.map((one) => one.label)
    }
  }
  // Why waiting too: a permission prompt asks nothing parseable; its tool is what it waits on.
  return (condition === 'working' || condition === 'waiting') && entry.toolName
    ? { kind: 'tool', tool: entry.toolName, detail: entry.toolInput || null }
    : null
}

/** What the session does now, for any row that shows one line: its question, else its tool. */
export function teamLiveActionOfEntry(entry: AgentStatusEntry): TeamLiveAction | null {
  return liveActionOf(entry, conditionOf(entry))
}

/** The session's own model and effort; a raw `claude-opus-5-5` reads `Opus 5.5`. */
export function teamSessionModelOf(
  entry: Pick<AgentStatusEntry, 'model' | 'effort'>
): TeamModel | null {
  const label = gameMemberLaunchOf({ model: entry.model ?? null, effort: null })?.model
  return label ? { label, effort: entry.effort || null, source: 'session' } : null
}

const modelOf = (entry: AgentStatusEntry, advisor: TeamAdvisorRow | null): TeamModel | null =>
  advisor?.model
    ? { label: advisor.model, effort: advisor.effort, source: 'advisor' }
    : teamSessionModelOf(entry)

function activityRowOf(session: TeamSoloSession): TeamActivityRow {
  const { entry } = session
  const condition = conditionOf(entry)
  return {
    paneKey: entry.paneKey,
    terminalHandle: entry.terminalHandle ?? null,
    worktreeId: entry.worktreeId ?? session.worktreeId,
    host: session.host,
    name: session.worktreeName,
    agentType: entry.agentType ?? null,
    status: STATUS_OF[condition] ?? 'idle',
    condition,
    since: entry.stateStartedAt,
    liveAction: liveActionOf(entry, condition),
    model: modelOf(entry, session.advisor),
    account: session.account,
    repoName: session.repoName,
    worktreeName: session.worktreeName,
    isPrimary: session.isPrimary,
    prompt: entry.prompt || null,
    ticket: session.ticket,
    pr: session.pr,
    lastMessage: entry.lastCompletedAssistantMessage || entry.lastAssistantMessage || null,
    cacheExpiresAt: session.cacheExpiresAt,
    ports: session.ports,
    note: session.note,
    subagentCount: entry.subagents?.length ?? 0,
    // Why empty: AgentStatusEntry keeps no tool history; the ORCA-1049 audit lists the gap.
    recentSteps: [],
    advisor: session.advisor
  }
}

const hostKeyOf = (host: TeamHost): string => (host.kind === 'local' ? '' : host.name)

/** The no-team panel: every session, needs-you first, opened on the selected one. */
export function teamSoloModelOf(input: {
  sessions: readonly TeamSoloSession[]
  selectedPaneKey: string | null
  tabs: TeamPanelTabs
}): TeamPanelSoloModel {
  const rows = input.sessions
    .map((session, index) => ({ row: activityRowOf(session), index }))
    .sort((a, b) => STATUS_RANK[a.row.status] - STATUS_RANK[b.row.status] || a.index - b.index)
    .map(({ row }) => row)
  const selected = rows.find((one) => one.paneKey === input.selectedPaneKey) ?? rows[0]
  const hosts = new Set(input.sessions.map((one) => hostKeyOf(one.host)))
  return {
    ...input.tabs,
    kind: 'solo',
    selectedPaneKey: selected?.paneKey ?? null,
    rows,
    machines: hosts.size > 1 ? input.tabs.machines : null
  }
}
