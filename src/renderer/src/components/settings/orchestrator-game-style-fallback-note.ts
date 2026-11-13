import { translate } from '@/i18n/i18n'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import {
  isQuestScene,
  orchestratorGameSceneArtOf,
  type OrchestratorGameSceneNative
} from '../../../../shared/orchestrator-game-scene-native'

/** What the Team panel draws instead of this scene's own art for the style, or null when it has it. */
export function gameStyleFallbackNote(
  style: GamePanelStyle,
  sceneId: string,
  styleLabel: string,
  /** The scene's definition when known; without it a scene file's own art cannot be seen here. */
  scene?: { native?: OrchestratorGameSceneNative }
): string | null {
  const { drawn, art } = orchestratorGameSceneArtOf({ style, sceneId, scene })
  if (drawn !== style) {
    return translate(
      'auto.components.settings.orchestrator-game-style-fallback-note.text',
      "This scene has no {{style}} art, so the Team panel draws the scene's own characters in Pixel.",
      { style: styleLabel }
    )
  }
  if (art === 'bundled' && !isQuestScene(sceneId)) {
    return translate(
      'auto.components.settings.orchestrator-game-style-fallback-note.office',
      "This scene has no {{style}} art, so the Team panel draws Orca's own office.",
      { style: styleLabel }
    )
  }
  return null
}
