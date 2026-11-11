import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneSpot
} from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneSiteView } from '../../../../shared/team-scene/team-scene-sites'

export type TeamScenePortraitSubject = Pick<
  TeamSceneActor,
  'role' | 'key' | 'characterKey' | 'name'
>

/** One frame in CSS px; the host already scaled the context for the device pixel ratio. */
export type TeamSceneFrame = {
  width: number
  height: number
  /** Device pixels per CSS px, for caches drawn off screen. */
  ratio: number
  /** Real seconds the scene has run, for idle sway and flicker; it stops while the scene is paused. */
  t: number
  dt: number
  actors: TeamSceneActor[]
  effects: TeamSceneEffect[]
  overflow: number
  stations: TeamSceneSpot[]
  /** Each seat's build at its real stage; a style without builds draws its stations instead. */
  sites: TeamSceneSiteView[]
  /** Merged work kept on stage, oldest first. */
  trophies: { key: string; name: string }[]
}

/** A scene style: Figures, Office or Pixel. `dispose` drops its cached backdrops and sprites. */
export type TeamScenePainter = {
  height: number
  /** Where a speaker's head tops out, so its bubble sits just above it. */
  headTop: (depth: number, height: number) => number
  /** Pixel's grid size when its bubbles are the game's thought cloud; glass otherwise. */
  cloudPixel?: number
  paint: (g: CanvasRenderingContext2D, frame: TeamSceneFrame) => void
  /** A card face `size` CSS px square, drawn as this style draws the same character. */
  portrait?: (g: CanvasRenderingContext2D, who: TeamScenePortraitSubject, size: number) => void
  dispose: () => void
}
