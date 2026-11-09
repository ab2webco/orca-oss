import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { buildAttentionByWorktree } from '../../smart-attention'
import { buildAgentStatusGroupByWorktree } from '../grouping/agent-status-groups'
import type { AgentStatusGroupKey } from '../grouping/agent-status-groups'
import type { WorktreeGroupBy } from '../grouping/row-types'

const NO_AGENT_STATUS: ReadonlyMap<string, AgentStatusGroupKey> = new Map()

type AgentStatusSourceState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'agentStatusByPaneKey'
  | 'runtimePaneTitlesByTabId'
  | 'ptyIdsByTabId'
  | 'migrationUnsupportedByPtyId'
  | 'terminalLayoutsByTabId'
>

// Same classifier as Smart sort, so Estado and the sort order never disagree.
export function selectAgentStatusGroupByWorktree(
  state: AgentStatusSourceState,
  groupBy: WorktreeGroupBy,
  worktrees: readonly Worktree[],
  now: number
): ReadonlyMap<string, AgentStatusGroupKey> {
  if (groupBy !== 'agent-status') {
    return NO_AGENT_STATUS
  }
  return buildAgentStatusGroupByWorktree(
    buildAttentionByWorktree(
      [...worktrees],
      state.tabsByWorktree,
      state.agentStatusByPaneKey,
      state.runtimePaneTitlesByTabId,
      state.ptyIdsByTabId,
      now,
      state.migrationUnsupportedByPtyId,
      state.terminalLayoutsByTabId
    )
  )
}

export function useAgentStatusGroupByWorktree(
  groupBy: WorktreeGroupBy,
  worktrees: readonly Worktree[]
): ReadonlyMap<string, AgentStatusGroupKey> {
  // Why null outside Estado: other groupings must not re-render the list on every agent tick.
  const source = useAppStore(
    useShallow((s): AgentStatusSourceState | null =>
      groupBy === 'agent-status'
        ? {
            tabsByWorktree: s.tabsByWorktree,
            agentStatusByPaneKey: s.agentStatusByPaneKey,
            runtimePaneTitlesByTabId: s.runtimePaneTitlesByTabId,
            ptyIdsByTabId: s.ptyIdsByTabId,
            migrationUnsupportedByPtyId: s.migrationUnsupportedByPtyId,
            terminalLayoutsByTabId: s.terminalLayoutsByTabId
          }
        : null
    )
  )
  return useMemo(
    () =>
      source
        ? selectAgentStatusGroupByWorktree(source, groupBy, worktrees, Date.now())
        : NO_AGENT_STATUS,
    [source, groupBy, worktrees]
  )
}
