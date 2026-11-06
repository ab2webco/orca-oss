import { useMemo } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import { resolveOrchestratorGamePanel } from '../../../../shared/orchestrator-game-panel-layers'
import { useTeamPanelSettingLayers } from '../team-panel/team-panel-setting-layers'

/** The scene style after global Settings, the project's orca.yaml and this machine's choice. */
export function useTeamSceneStyle(): GamePanelStyle {
  const { global, project, local } = useTeamPanelSettingLayers()
  return useMemo(
    () => resolveOrchestratorGamePanel({ global, project, local }).style,
    [global, local, project]
  )
}
