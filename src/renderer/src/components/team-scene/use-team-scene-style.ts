import { useMemo } from 'react'
import type {
  GamePanelStyle,
  OrchestratorGamePanel
} from '../../../../shared/orchestrator-game-panel'
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

/** Whether Figures draws as the 3D diorama (ORCA-1296), after the same three layers. */
export function useTeamSceneDiorama(): boolean {
  const { global, project, local } = useTeamPanelSettingLayers()
  return useMemo(
    () => resolveOrchestratorGamePanel({ global, project, local }).diorama,
    [global, local, project]
  )
}

/** The diorama's drawing quality and its lead's pace, after the same three layers. */
export function useTeamSceneDioramaLook(): Pick<OrchestratorGamePanel, 'quality' | 'pace'> {
  const { global, project, local } = useTeamPanelSettingLayers()
  const panel = useMemo(
    () => resolveOrchestratorGamePanel({ global, project, local }),
    [global, local, project]
  )
  const { quality, pace } = panel
  return useMemo(() => ({ quality, pace }), [quality, pace])
}
