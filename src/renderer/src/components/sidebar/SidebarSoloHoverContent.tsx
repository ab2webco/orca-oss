import React, { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  teamSoloSessionOf,
  type TeamSoloSessionsState
} from '@/components/team-panel/team-panel-solo-sessions'
import { teamActivityRowOf } from '../../../../shared/team-panel-activity-rows'
import type { Repo, Worktree } from '../../../../shared/types'
import { sidebarSoloHoverOf } from './sidebar-solo-hover'
import { SidebarSoloHoverDetails } from './SidebarSoloHoverDetails'

function sessionInputsOf(s: AppState): TeamSoloSessionsState {
  return {
    agentStatusByPaneKey: s.agentStatusByPaneKey,
    tabsByWorktree: s.tabsByWorktree,
    worktreesByRepo: s.worktreesByRepo,
    repos: s.repos,
    settings: s.settings,
    cacheTimerByKey: s.cacheTimerByKey,
    hostedReviewCache: s.hostedReviewCache,
    workspacePortScan: s.workspacePortScan,
    claudeAccountRoster: s.claudeAccountRoster,
    folderWorkspaces: s.folderWorkspaces,
    runtimeEnvironments: s.runtimeEnvironments,
    sshTargetLabels: s.sshTargetLabels,
    sshConnectionStates: s.sshConnectionStates,
    terminalLayoutsByTabId: s.terminalLayoutsByTabId
  }
}

/** The open solo card's facts. Why mounted only while open: it reads the store on every change. */
export function SidebarSoloHoverContent({
  worktree,
  repo,
  paneKey
}: {
  worktree: Worktree
  repo: Repo | undefined
  paneKey: string
}): React.JSX.Element | null {
  const inputs = useAppStore(useShallow(sessionInputsOf))
  const entry = inputs.agentStatusByPaneKey[paneKey]
  const hover = useMemo(
    () =>
      entry
        ? sidebarSoloHoverOf(teamActivityRowOf(teamSoloSessionOf(inputs, entry, worktree, repo)))
        : null,
    [entry, inputs, worktree, repo]
  )
  if (!hover) {
    return null
  }
  return (
    <SidebarSoloHoverDetails hover={hover} cacheTtlMs={inputs.settings?.promptCacheTtlMs ?? 0} />
  )
}
