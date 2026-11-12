import type {
  TeamSceneActor,
  TeamSceneEffect,
  TeamSceneStation
} from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneSiteView } from '../../../../shared/team-scene/team-scene-sites'
import type { TeamSceneLayout } from '../../../../shared/team-scene/team-scene-director'

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
  stations: TeamSceneStation[]
  /** Each seat's build at its real stage; a style without builds draws its stations instead. */
  sites: TeamSceneSiteView[]
  /** Merged work kept on stage, oldest first. */
  trophies: { key: string; name: string }[]
  /** The project's launch STOP is set. */
  stopped?: boolean
}

/** A scene style: Figures, Office or Pixel. `dispose` drops its cached backdrops and sprites. */
export type TeamScenePainter = {
  height: number
  /** Where a speaker's head tops out, so its bubble sits just above it. */
  headTop: (depth: number, height: number) => number
  /** Pixel's grid size when its bubbles are the game's thought cloud; glass otherwise. */
  cloudPixel?: number
  /** How this style seats the team; absent, the ground layout of Figures and Pixel. */
  layout?: TeamSceneLayout
  /** The widest stage it draws whole; wider, the stage is capped and centred. Absent: any width. */
  maxWidth?: number
  /** The centre of an actor's emote when the style moves it off the head; null keeps it there. */
  emoteAt?: (
    a: TeamSceneActor,
    f: Pick<TeamSceneFrame, 'width' | 'height' | 'stations'>
  ) => { x: number; y: number } | null
  paint: (g: CanvasRenderingContext2D, frame: TeamSceneFrame) => void
  /** A card face `size` CSS px square, drawn as this style draws the same character. */
  portrait?: (g: CanvasRenderingContext2D, who: TeamScenePortraitSubject, size: number) => void
  dispose: () => void
}
