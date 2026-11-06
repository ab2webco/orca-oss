import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getFocusedAgentPaneKeyForWorktree } from '../sidebar/focused-agent-row-highlight'
import { teamSoloModelOf } from '../../../../shared/team-panel-activity-rows'
import type { TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import { teamSoloSessionsOf, type TeamSoloSessionsState } from './team-panel-solo-sessions'

type SoloInputs = TeamSoloSessionsState & { selectedPaneKey: string | null }

function soloInputsOf(s: AppState): SoloInputs {
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
    selectedPaneKey: s.activeWorktreeId
      ? getFocusedAgentPaneKeyForWorktree(s, s.activeWorktreeId)
      : null
  }
}

/** The no-team model from the agent status Orca already holds; needs no game or plugin. */
export function teamPanelSoloModelFrom(inputs: SoloInputs): TeamPanelSoloModel {
  const model = teamSoloModelOf({
    sessions: teamSoloSessionsOf(inputs),
    selectedPaneKey: inputs.selectedPaneKey,
    // Why null: PRs, Queue and Machines bodies come with ORCA-1073; until then the tabs stay hidden.
    tabs: {
      inbox: { kind: 'loading' },
      prs: null,
      queue: null,
      machines: null
    }
  })
  // Why questions, not attention: Inbox lists only these, and a count must match what it opens on.
  const forYou = model.rows.filter((row) => row.liveAction?.kind === 'question').length
  return {
    ...model,
    inbox: {
      kind: 'ready',
      value: { forYou, waiting: 0, threads: 0, answered: 0 }
    }
  }
}

const IDLE: SoloInputs | null = null

/** Null while `active` is false, so a team view pays nothing for agent status churn. */
export function useTeamPanelSoloModel(active: boolean): TeamPanelSoloModel | null {
  const inputs = useAppStore(useShallow((s) => (active ? soloInputsOf(s) : IDLE)))
  return useMemo(() => (inputs ? teamPanelSoloModelFrom(inputs) : null), [inputs])
}
