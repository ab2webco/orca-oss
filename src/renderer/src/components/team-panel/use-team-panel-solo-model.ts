import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getFocusedAgentPaneKeyForWorktree } from '../sidebar/focused-agent-row-highlight'
import { teamSoloModelOf } from '../../../../shared/team-panel-activity-rows'
import type { GameHostReading } from '../../../../shared/orchestrator-game-host-capacity'
import type { TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import {
  teamHostKeyOf,
  teamSoloMachineHostsOf,
  teamSoloMachinesOf
} from '../../../../shared/team-panel-solo-machines'
import type { TeamSoloSession } from '../../../../shared/team-panel-activity-rows'
import { teamSoloSessionsOf, type TeamSoloSessionsState } from './team-panel-solo-sessions'
import { useTeamPanelTabStore } from './team-panel-tab-store'
import { useTeamSoloMachineReadings } from './use-team-solo-machine-readings'

type MachineReadings = ReadonlyMap<string, GameHostReading>

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

function machinesOf(
  inputs: SoloInputs,
  sessions: readonly TeamSoloSession[],
  readings: MachineReadings | null
): TeamPanelSoloModel['machines'] {
  if (!readings) {
    return { kind: 'loading' }
  }
  return {
    kind: 'ready',
    value: teamSoloMachinesOf({
      hosts: teamSoloMachineHostsOf({ sessions, environments: inputs.runtimeEnvironments }),
      sessions,
      readingOf: (host) => readings.get(teamHostKeyOf(host)) ?? null
    })
  }
}

/** The no-team model from the agent status Orca already holds; needs no game or plugin. */
export function teamPanelSoloModelFrom(
  inputs: SoloInputs,
  readings: MachineReadings | null = null
): TeamPanelSoloModel {
  const sessions = teamSoloSessionsOf(inputs)
  const model = teamSoloModelOf({
    sessions,
    selectedPaneKey: inputs.selectedPaneKey,
    // Why no PRs or Queue: both come from a lead's game.state, and with no team there is none.
    tabs: {
      inbox: { kind: 'loading' },
      prs: null,
      queue: null,
      machines: machinesOf(inputs, sessions, readings)
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
  const environmentIds = (inputs?.runtimeEnvironments ?? []).map((one) => one.id).join('\n')
  const machinesShown = useTeamPanelTabStore((s) => s.shown === 'machines')
  const readings = useTeamSoloMachineReadings(environmentIds, active && machinesShown)
  return useMemo(
    () => (inputs ? teamPanelSoloModelFrom(inputs, readings) : null),
    [inputs, readings]
  )
}
