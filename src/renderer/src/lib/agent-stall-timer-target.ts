import { parsePaneKey } from '../../../shared/stable-pane-id'
import { isFolderRepo } from '../../../shared/repo-kind'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { AppState } from '../store/types'
import type { AgentStallTimerEntry } from '../store/slices/agent-stall-timer'

export type AgentStallTimerTargetState = Pick<AppState, 'tabsByWorktree' | 'repos'>

export type AgentStallTimerTarget = {
  worktreePath: string
  connectionId?: string
}

export type AgentStallTimerAvailability =
  | { available: true }
  /** The workspace is a folder, so there is no git history or working tree to measure. */
  | { available: false; reason: 'folder-workspace' }
  /** The pane is not attached to a resolvable workspace yet. */
  | { available: false; reason: 'no-workspace' }

/** Resolves the worktree a pane's progress must be read from. Never gates on which agent runs there. */
export function resolveAgentStallTimerTarget(
  state: AgentStallTimerTargetState,
  paneKey: string
): AgentStallTimerTarget | null {
  const worktreeId = resolveWorktreeIdForPane(state, paneKey)
  if (!worktreeId) {
    return null
  }
  const parsed = splitWorktreeId(worktreeId)
  if (!parsed) {
    return null
  }
  const repo = findRepo(state, parsed.repoId)
  if (repo && isFolderRepo(repo)) {
    return null
  }
  return {
    worktreePath: parsed.worktreePath,
    ...(repo?.connectionId ? { connectionId: repo.connectionId } : {})
  }
}

/** Why the control is offered or disabled, so the UI can say which rather than look dead. */
export function getAgentStallTimerAvailability(
  state: AgentStallTimerTargetState,
  paneKey: string
): AgentStallTimerAvailability {
  const worktreeId = resolveWorktreeIdForPane(state, paneKey)
  const parsed = worktreeId ? splitWorktreeId(worktreeId) : null
  if (!parsed) {
    return { available: false, reason: 'no-workspace' }
  }
  const repo = findRepo(state, parsed.repoId)
  if (repo && isFolderRepo(repo)) {
    return { available: false, reason: 'folder-workspace' }
  }
  return { available: true }
}

function findRepo(
  state: AgentStallTimerTargetState,
  repoId: string
): AgentStallTimerTargetState['repos'][number] | undefined {
  return (state.repos ?? []).find((candidate) => candidate.id === repoId)
}

export function resolveWorktreeIdForPane(
  state: AgentStallTimerTargetState,
  paneKey: string
): string | null {
  const parsedPaneKey = parsePaneKey(paneKey)
  if (!parsedPaneKey) {
    return null
  }
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree ?? {})) {
    if (tabs.some((tab) => tab.id === parsedPaneKey.tabId)) {
      return worktreeId
    }
  }
  return null
}

export type StalledWorkspacePane = { paneKey: string; entry: AgentStallTimerEntry }

/**
 * Stalled panes of one workspace, read from the timer map rather than the agent rows: a pane
 * whose process died stops producing a row, and that is exactly when the alert must survive.
 */
export function selectStalledPanesForWorktree(
  state: Pick<AppState, 'tabsByWorktree' | 'agentStallTimerByPaneKey'>,
  worktreeId: string
): StalledWorkspacePane[] {
  // Partial store states reach this during hydration and in card tests, so every map read
  // must survive an absent slice rather than throw inside a render.
  const tabIds = new Set((state.tabsByWorktree?.[worktreeId] ?? []).map((tab) => tab.id))
  if (tabIds.size === 0) {
    return []
  }
  return Object.entries(state.agentStallTimerByPaneKey ?? {})
    .filter(([paneKey, entry]) => {
      if (entry.status !== 'stalled') {
        return false
      }
      const parsed = parsePaneKey(paneKey)
      return parsed !== null && tabIds.has(parsed.tabId)
    })
    .map(([paneKey, entry]) => ({ paneKey, entry }))
}
