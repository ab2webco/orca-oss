import { translate } from '@/i18n/i18n'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import { orchestratorGameSceneDrawnStyle } from '../../../../shared/orchestrator-game-scene-native'

/** Why the Team panel draws Pixel for this choice, or null when it draws what was chosen. */
export function gameStyleFallbackNote(
  style: GamePanelStyle,
  sceneId: string,
  styleLabel: string
): string | null {
  // Why no scene art passed: the panel reads only Quest's bundled art until ORCA-1085.
  if (style === 'pixel' || orchestratorGameSceneDrawnStyle({ style, sceneId }) === style) {
    return null
  }
  return translate(
    'auto.components.settings.orchestrator-game-style-fallback-note.text',
    'This scene has no {{style}} art, so the Team panel draws it in Pixel.',
    { style: styleLabel }
  )
}
