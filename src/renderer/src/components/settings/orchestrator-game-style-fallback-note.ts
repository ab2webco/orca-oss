import { translate } from '@/i18n/i18n'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import { isQuestScene } from '../../../../shared/orchestrator-game-scene-native'

/** Says a themed scene leaves Figures and Office as Orca draws them, or null when nothing differs. */
export function gameStyleFallbackNote(
  style: GamePanelStyle,
  sceneId: string,
  styleLabel: string
): string | null {
  if (style === 'pixel' || isQuestScene(sceneId)) {
    return null
  }
  return translate(
    'auto.components.settings.orchestrator-game-style-fallback-note.fixed',
    "{{style}} always draws Orca's own art; this scene changes Pixel only.",
    { style: styleLabel }
  )
}
