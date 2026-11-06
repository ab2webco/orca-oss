import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'

/**
 * Pixel, ORCA-1071's style for an unset `orchestratorGame.panel.style`, until its resolved
 * setting reaches the renderer; then this reads it, like `useTeamPanelLook`.
 */
export function useTeamSceneStyle(): GamePanelStyle {
  return 'pixel'
}
