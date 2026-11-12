import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'

type RoleArt = OrchestratorGameSceneNativeStyle['roles']['lead']

// Why these fractions: Quest's figures stand about 0.75 of a frame tall, head in the top 0.44.
const PORTRAIT_SIDE = 0.44
const PORTRAIT_TOP = 0.76

/** A card's face: the head of a role's idle frame from `sheet`, drawn `size` px square. */
export function drawImagePortrait(
  g: CanvasRenderingContext2D,
  art: RoleArt,
  sheet: CanvasImageSource,
  size: number
): void {
  const feet = art.feet ?? { x: art.frame.width / 2, y: art.frame.height }
  const side = Math.round(art.frame.height * PORTRAIT_SIDE)
  const top = Math.max(0, Math.round(feet.y - art.frame.height * PORTRAIT_TOP))
  const left = Math.min(Math.max(0, Math.round(feet.x - side / 2)), art.frame.width - side)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  const row = art.animations.idle.row * art.frame.height
  g.drawImage(sheet, left, row + top, side, side, 0, 0, size, size)
}
