import type {
  TeamSceneActor,
  TeamSceneEffect
} from '../../../../shared/team-scene/team-scene-types'

/** One frame in CSS px; the host already scaled the context for the device pixel ratio. */
export type TeamSceneFrame = {
  width: number
  height: number
  /** Scene seconds, for idle sway and flicker; it stops while the scene is paused. */
  t: number
  dt: number
  actors: TeamSceneActor[]
  effects: TeamSceneEffect[]
  overflow: number
}

/** A scene style: Figures, Office or Pixel. `dispose` drops its cached backdrops and sprites. */
export type TeamScenePainter = {
  height: number
  paint: (g: CanvasRenderingContext2D, frame: TeamSceneFrame) => void
  dispose: () => void
}
