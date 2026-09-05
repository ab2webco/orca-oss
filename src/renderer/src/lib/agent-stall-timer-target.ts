import { parsePaneKey } from '../../../shared/stable-pane-id'
import { isFolderRepo } from '../../../shared/repo-kind'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { AppState } from '../store/types'

/** What resolving a target and its availability actually reads. */
export type AgentStallTimerTargetState = Pick<AppState, 'tabsByWorktree' | 'repos'>

/** Target state plus the armed timers the card-level selectors read. */
export type AgentStallTimerSelectorState = AgentStallTimerTargetState &
  Pick<AppState, 'agentStallTimerByPaneKey'>

export type AgentStallTimerTarget = {
  worktreeId: string
  worktreePath: string
}

export type AgentStallTimerUnavailableReason =
  /** No git, so there is no history or working tree to measure. */
  | 'folder-workspace'
  /** The relay cannot run the probe yet, so an armed timer here would never fire. */
  | 'remote-workspace'
  /** The pane is not attached to a resolvable workspace. */
  | 'no-workspace'

export type AgentStallTimerAvailability =
  | { available: true }
  | { available: false; reason: AgentStallTimerUnavailableReason }

/** Resolves the worktree a pane's progress is read from. Never gates on which agent runs there. */
export function resolveAgentStallTimerTarget(
  state: AgentStallTimerTargetState,
  paneKey: string
): AgentStallTimerTarget | null {
  const worktreeId = resolveWorktreeIdForPane(state, paneKey)
  const parsed = worktreeId ? splitWorktreeId(worktreeId) : null
  if (!worktreeId || !parsed || !getAgentStallTimerAvailability(state, paneKey).available) {
    return null
  }
  return { worktreeId, worktreePath: parsed.worktreePath }
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
  if (repo?.connectionId) {
    return { available: false, reason: 'remote-workspace' }
  }
  return { available: true }
}

/**
 * Stalled panes of one workspace, read from the timer map rather than the agent rows: a pane
 * whose process died stops producing a row, and that is exactly when the alert must survive.
 */
export function selectStalledPaneKeysForWorktree(
  state: AgentStallTimerSelectorState,
  worktreeId: string
): string[] {
  const tabIds = tabIdsForWorktree(state, worktreeId)
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
    .map(([paneKey]) => paneKey)
}

/** Armed panes of one workspace whose target can no longer be measured, so the card can offer
 *  the only disarm surface left once the agent row is gone. */
export function selectUnmeasurablePaneKeysForWorktree(
  state: AgentStallTimerSelectorState,
  worktreeId: string
): string[] {
  const tabIds = tabIdsForWorktree(state, worktreeId)
  // Availability is a property of the workspace's repo, so it is decided once per worktree
  // rather than re-derived for every armed pane on every store write.
  if (tabIds.size === 0 || isMeasurableWorktree(state, worktreeId)) {
    return []
  }
  return Object.keys(state.agentStallTimerByPaneKey ?? {}).filter((paneKey) => {
    const parsed = parsePaneKey(paneKey)
    return parsed !== null && tabIds.has(parsed.tabId)
  })
}

function isMeasurableWorktree(state: AgentStallTimerTargetState, worktreeId: string): boolean {
  const parsed = splitWorktreeId(worktreeId)
  if (!parsed) {
    return false
  }
  const repo = findRepo(state, parsed.repoId)
  return !repo || (!isFolderRepo(repo) && !repo.connectionId)
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

// Partial store states reach these during hydration and in card tests, so every map read must
// survive an absent slice rather than throw inside a render.
function tabIdsForWorktree(state: AgentStallTimerTargetState, worktreeId: string): Set<string> {
  return new Set((state.tabsByWorktree?.[worktreeId] ?? []).map((tab) => tab.id))
}

function findRepo(
  state: AgentStallTimerTargetState,
  repoId: string
): AgentStallTimerTargetState['repos'][number] | undefined {
  return (state.repos ?? []).find((candidate) => candidate.id === repoId)
}
