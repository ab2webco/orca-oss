import { useMemo } from 'react'
import type {
  GamePanelLook,
  OrchestratorGamePanel
} from '../../../../shared/orchestrator-game-panel'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'
import { useTeamPanelSettingLayers } from './team-panel-setting-layers'

/** ORCA-1071's `orchestratorGame.panel.look`. */
export type TeamPanelLook = GamePanelLook

/** The panel settings after global Settings, the project's orca.yaml and this machine's override. */
export function useTeamPanelSettings(): OrchestratorGamePanel {
  const { global, project, local } = useTeamPanelSettingLayers()
  return useMemo(
    () => resolveOrchestratorGamePanel({ global, project, local }),
    [global, local, project]
  )
}

export function useTeamPanelLook(): TeamPanelLook {
  return useTeamPanelSettings().look
}
