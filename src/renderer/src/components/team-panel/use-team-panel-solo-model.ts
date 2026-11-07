import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getFocusedAgentPaneKeyForWorktree } from '../sidebar/focused-agent-row-highlight'
import {
  teamAdvisorRowOf,
  teamSoloModelOf,
  type TeamSoloSession
} from '../../../../shared/team-panel-activity-rows'
import type { GameHostReading } from '../../../../shared/orchestrator-game-host-capacity'
import type { GameMemberAdvisor } from '../../../../shared/orchestrator-game-member-advisor'
import type { TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import {
  teamHostKeyOf,
  teamSoloMachineHostsOf,
  teamSoloMachinesOf
} from '../../../../shared/team-panel-solo-machines'
import {
  teamSoloAdvisorReadsOf,
  teamSoloSessionsOf,
  type TeamSoloSessionsState
} from './team-panel-solo-sessions'
import { useTeamPanelTabStore } from './team-panel-tab-store'
import { useTeamSoloAdvisors } from './use-team-solo-advisors'
import { useTeamSoloMachineReadings } from './use-team-solo-machine-readings'
import { useGameLeadHandles } from './game-lead-handles'
import { teamInboxAgentQuestionsOf } from './team-panel-inbox-agents'

type MachineReadings = ReadonlyMap<string, GameHostReading>

type SoloInputs = TeamSoloSessionsState &
  Pick<AppState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'> & { selectedPaneKey: string | null }

function soloInputsOf(s: AppState): SoloInputs {
  return {
    agentStatusByPaneKey: s.agentStatusByPaneKey,
    tabsByWorktree: s.tabsByWorktree,
    ptyIdsByTabId: s.ptyIdsByTabId,
    terminalLayoutsByTabId: s.terminalLayoutsByTabId,
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
  reads: {
    sessions?: readonly TeamSoloSession[]
    readings?: MachineReadings | null
    advisors?: ReadonlyMap<string, GameMemberAdvisor>
  } = {}
): TeamPanelSoloModel {
  const sessions = (reads.sessions ?? teamSoloSessionsOf(inputs)).map((session) => {
    const advisor = reads.advisors?.get(session.entry.paneKey)
    return advisor ? { ...session, advisor: teamAdvisorRowOf(advisor) } : session
  })
  const model = teamSoloModelOf({
    sessions,
    selectedPaneKey: inputs.selectedPaneKey,
    // Why no PRs or Queue: both come from a lead's game.state, and with no team there is none.
    tabs: {
      inbox: { kind: 'loading' },
      prs: null,
      queue: null,
      machines: machinesOf(inputs, sessions, reads.readings ?? null)
    }
  })
  // Why questions, not attention: Inbox lists only these, and a count must match what it opens on.
  const forYou = teamInboxAgentQuestionsOf(model, inputs).length
  return {
    ...model,
    inbox: {
      kind: 'ready',
      value: { forYou, waiting: 0, threads: 0, answered: 0 }
    }
  }
}

const IDLE: SoloInputs | null = null
const NO_SESSIONS: readonly TeamSoloSession[] = []

/** Null while `active` is false, so a team view pays nothing for agent status churn. */
export function useTeamPanelSoloModel(active: boolean): TeamPanelSoloModel | null {
  const inputs = useAppStore(useShallow((s) => (active ? soloInputsOf(s) : IDLE)))
  const leadHandles = useGameLeadHandles()
  const sessions = useMemo(
    () => (inputs ? teamSoloSessionsOf(inputs, leadHandles) : NO_SESSIONS),
    [inputs, leadHandles]
  )
  const environmentIds = (inputs?.runtimeEnvironments ?? []).map((one) => one.id).join('\n')
  const shownTab = useTeamPanelTabStore((s) => s.shown)
  // Why: Jev reaches a pane only through its plugin, so with the plugin system off nothing is asked.
  const pluginsOn = useAppStore((s) => s.settings?.pluginSystemEnabled === true)
  const readings = useTeamSoloMachineReadings(environmentIds, active && shownTab === 'machines')
  const advisors = useTeamSoloAdvisors(
    JSON.stringify(teamSoloAdvisorReadsOf(sessions)),
    active && pluginsOn && shownTab === 'activity'
  )
  // Why not only the read: reports held from before the switch would go on naming the model.
  const reports = pluginsOn ? advisors : undefined
  return useMemo(
    () =>
      inputs ? teamPanelSoloModelFrom(inputs, { sessions, readings, advisors: reports }) : null,
    [inputs, sessions, readings, reports]
  )
}
