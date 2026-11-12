import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import type { TeamSceneArtImage } from './team-scene-image-painter'

/**
 * The widest stage a style's art covers whole: its backdrop's own width at the stage height.
 * Past it, cover scales the art up, its window rises out of view and edges never meant to be seen
 * fill the stage; absent without a backdrop.
 */
export function teamSceneArtMaxWidth(
  style: OrchestratorGameSceneNativeStyle,
  images: ReadonlyMap<string, TeamSceneArtImage>,
  height: number
): number | undefined {
  const layer = style.layers.find((one) => !one.front)
  const image = layer ? images.get(layer.src) : undefined
  return image ? Math.floor((image.width * height) / image.height) : undefined
}
