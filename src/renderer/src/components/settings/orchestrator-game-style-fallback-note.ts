import { translate } from '@/i18n/i18n'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import {
  orchestratorGameSceneArtOf,
  type OrchestratorGameSceneNative
} from '../../../../shared/orchestrator-game-scene-native'

/** Why the Team panel draws Orca's default art for this choice, or null when it has the scene's own. */
export function gameStyleFallbackNote(
  style: GamePanelStyle,
  sceneId: string,
  styleLabel: string,
  /** The scene's definition when known; without it a scene file's own art cannot be seen here. */
  scene?: { native?: OrchestratorGameSceneNative }
): string | null {
  if (!orchestratorGameSceneArtOf({ style, sceneId, scene }).defaultArt) {
    return null
  }
  return translate(
    'auto.components.settings.orchestrator-game-style-fallback-note.text',
    'This scene has no {{style}} art, so the Team panel draws it with the default art.',
    { style: styleLabel }
  )
}
