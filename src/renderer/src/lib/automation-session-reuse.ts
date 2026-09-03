import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import type { AutomationRun } from '../../../shared/automations-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { AppState } from '@/store/types'

export type ReusableAutomationSession = {
  tabId: string
  ptyId: string
  paneKey: string
}

export function findReusableAutomationSession(args: {
  automationId: string
  agentId: TuiAgent
  worktreeId: string
  currentRunId: string
  runs: AutomationRun[]
  targetPaneKey?: string | null
  state: Pick<
    AppState,
    'agentStatusByPaneKey' | 'ptyIdsByTabId' | 'terminalLayoutsByTabId' | 'unifiedTabsByWorktree'
  >
}): ReusableAutomationSession | null {
  const { automationId, agentId, worktreeId, currentRunId, runs, targetPaneKey, state } = args
  const worktreeTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const terminalTabIds = new Set(
    worktreeTabs.filter((tab) => tab.contentType === 'terminal').map((tab) => tab.entityId)
  )
  // Why: an explicitly configured pane wins; when it is gone or not reusable
  // the search falls back to run history, never to a scanned substitute pane.
  if (targetPaneKey) {
    const configured = findReusableConfiguredPane({ state, terminalTabIds, agentId, targetPaneKey })
    if (configured) {
      return configured
    }
  }
  const candidates = runs
    .filter(
      (run) =>
        run.id !== currentRunId &&
        run.automationId === automationId &&
        run.workspaceId === worktreeId &&
        run.status === 'completed' &&
        Boolean(run.terminalPaneKey) &&
        Boolean(run.terminalPtyId)
    )
    .sort((left, right) => right.createdAt - left.createdAt)

  for (const run of candidates) {
    const exactPane = findReusableExactRunPane({ state, terminalTabIds, agentId, run })
    if (exactPane) {
      return exactPane
    }
  }
  return null
}

function findReusableConfiguredPane({
  state,
  terminalTabIds,
  agentId,
  targetPaneKey
}: {
  state: Pick<AppState, 'agentStatusByPaneKey' | 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>
  terminalTabIds: Set<string>
  agentId: TuiAgent
  targetPaneKey: string
}): ReusableAutomationSession | null {
  const parsed = parsePaneKey(targetPaneKey)
  if (!parsed || !terminalTabIds.has(parsed.tabId)) {
    return null
  }
  const entry = state.agentStatusByPaneKey[targetPaneKey]
  if (!entry || !isReusableAgentStatus(entry, agentId)) {
    return null
  }
  // Why: a user-opened pane has no run record, so its PTY identity must come
  // from the live layout instead of run history.
  const ptyId = state.terminalLayoutsByTabId[parsed.tabId]?.ptyIdsByLeafId?.[parsed.leafId]
  if (!ptyId || !state.ptyIdsByTabId[parsed.tabId]?.includes(ptyId)) {
    return null
  }
  return { tabId: parsed.tabId, ptyId, paneKey: targetPaneKey }
}

function findReusableExactRunPane({
  state,
  terminalTabIds,
  agentId,
  run
}: {
  state: Pick<AppState, 'agentStatusByPaneKey' | 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>
  terminalTabIds: Set<string>
  agentId: TuiAgent
  run: AutomationRun
}): ReusableAutomationSession | null {
  if (!run.terminalPaneKey || !run.terminalPtyId) {
    return null
  }
  const parsed = parsePaneKey(run.terminalPaneKey)
  if (!parsed || !terminalTabIds.has(parsed.tabId)) {
    return null
  }
  const entry = state.agentStatusByPaneKey[run.terminalPaneKey]
  if (!entry || !isReusableAgentStatus(entry, agentId)) {
    return null
  }
  if (!isRunPtyLiveInPane(state, parsed.tabId, parsed.leafId, run.terminalPtyId)) {
    return null
  }
  return { tabId: parsed.tabId, ptyId: run.terminalPtyId, paneKey: run.terminalPaneKey }
}

// `working` reuses: the paste queues behind the running turn, as it does when a person
// types while an agent works. `blocked` and `waiting` sit at a prompt expecting a specific
// answer, so a pasted automation prompt would be submitted as that answer.
function isReusableAgentStatus(entry: AgentStatusEntry, agentId: TuiAgent): boolean {
  if (entry.state !== 'done' && entry.state !== 'working') {
    return false
  }
  if (entry.interactivePrompt != null) {
    return false
  }
  return !entry.agentType || entry.agentType === 'unknown' || entry.agentType === agentId
}

function isRunPtyLiveInPane(
  state: Pick<AppState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>,
  tabId: string,
  leafId: string,
  ptyId: string
): boolean {
  if (!state.ptyIdsByTabId[tabId]?.includes(ptyId)) {
    return false
  }
  const layoutPtyId = state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId]
  return layoutPtyId === undefined || layoutPtyId === ptyId
}
