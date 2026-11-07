import { useMemo } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { keepArcadeOffer, playSavedArcadeRun } from '../game-arcade/game-arcade-client'
import { teamArcadeActionsOf } from './team-panel-arcade-actions'
import type { TeamArcadeActions } from './TeamArcadeSection'
import { refreshTeamPanelModel } from './use-team-panel-model'

const failed = (): void => {
  toast.error(translate('teamPanel.arcade.failed', 'Could not reach the host for your saved play'))
}

/** Play and Keep against the lead's project; null while Settings turn the arcade off. */
export function useTeamArcadeActions(model: TeamPanelGameModel): TeamArcadeActions | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const openTab = useAppStore((s) => s.openGameArcadeTab)
  const global = useAppStore((s) => s.settings?.orchestratorGame)
  const local = useAppStore((s) => s.settings?.orchestratorGameProjects?.[model.repoId])
  const leadWorktreeId = model.lead.worktreeId
  return useMemo(
    () =>
      teamArcadeActionsOf({
        enabled: resolveOrchestratorGamePanel({ global, local }).arcade,
        target: gameInboxTargetOf(hostId),
        leadWorktreeId,
        activeWorktreeId,
        play: playSavedArcadeRun,
        keep: keepArcadeOffer,
        openTab,
        refresh: refreshTeamPanelModel,
        failed
      }),
    [activeWorktreeId, global, hostId, leadWorktreeId, local, openTab]
  )
}
