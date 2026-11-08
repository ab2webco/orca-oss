import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { figureSeedOf } from './team-scene-figure-looks'
import type {
  TeamSceneFrame,
  TeamScenePainter,
  TeamScenePortraitSubject
} from './team-scene-painter'
import {
  createSceneBackdrop,
  createSceneEffects,
  drawSceneEmote,
  drawSceneOverflow,
  type TeamSceneStatusColors
} from './team-scene-painter-marks'

type RoleArt = OrchestratorGameSceneNativeStyle['roles']['lead']

export type TeamSceneArtImage = ImageBitmap

/** A native style with every image it names decoded, keyed by the path the style uses. */
export type TeamSceneImageArt = {
  style: OrchestratorGameSceneNativeStyle
  images: ReadonlyMap<string, TeamSceneArtImage>
}

/** The art styles' stage, which the panel holds while their images decode. */
export const TEAM_SCENE_ART_HEIGHT = 176
const TAU = 2 * Math.PI
const SEAT_PX = 2
const SHADOW_WIDTH = 0.2
const PORTRAIT_SIDE = 0.44
const PORTRAIT_TOP = 0.76
const feetY = (depth: number, h: number): number => h - 36 + depth * 22
// Why against the front: `size` is the drawn height at the front of the stage.
const depthScale = (depth: number): number => teamSceneScaleAt(depth) / teamSceneScaleAt(1)

/** One layer drawn to cover the stage from its bottom edge, centered across it. */
function coverStage(
  g: CanvasRenderingContext2D,
  image: TeamSceneArtImage,
  w: number,
  h: number
): void {
  const scale = Math.max(w / image.width, h / image.height)
  const drawn = { width: image.width * scale, height: image.height * scale }
  g.drawImage(image, (w - drawn.width) / 2, h - drawn.height, drawn.width, drawn.height)
}

/** Walk runs on the ground the figure covers; everything else runs on the scene's clock. */
function frameOf(
  art: RoleArt,
  a: TeamSceneActor,
  seated: boolean,
  t: number,
  sheetPx: number
): [number, number] {
  if (a.pose === 'done') {
    // Why held: done is a finished stance, apart from idle's breathing and work's loop.
    const cheer = art.animations.cheer
    return cheer ? [cheer.row, cheer.frames - 1] : [art.animations.idle.row, 0]
  }
  // Why: `work` is drawn at a station; with none, V28's lead works by handing out its scroll.
  const pose = a.pose === 'work' && !seated ? (art.animations.give ? 'give' : 'idle') : a.pose
  const animation = art.animations[pose] ?? art.animations.idle
  if (pose !== 'walk' || !art.animations.walk) {
    return [animation.row, Math.floor((t + a.x * 7) * animation.fps) % animation.frames]
  }
  const { stride } = animation
  const cycles = stride ? (a.gait / Math.PI) * (a.stride / (stride * sheetPx)) : a.gait / TAU
  return [animation.row, Math.floor(cycles * animation.frames) % animation.frames]
}

/** Figures or Office drawn from a scene's images; the shared simulation places every figure. */
export function createImagePainter(args: {
  art: TeamSceneImageArt
  colors: TeamSceneStatusColors
}): TeamScenePainter {
  const { style, images } = args.art
  const { colors } = args
  const image = (src: string): TeamSceneArtImage => images.get(src)!
  const layersOf = (front: boolean) => (g: CanvasRenderingContext2D, w: number, h: number) => {
    for (const layer of style.layers.filter((one) => Boolean(one.front) === front)) {
      coverStage(g, image(layer.src), w, h)
    }
  }
  const backdrop = createSceneBackdrop(layersOf(false))
  const foreground = createSceneBackdrop(layersOf(true))
  const hasForeground = style.layers.some((one) => one.front)
  const effects = createSceneEffects(feetY)
  const roleOf = (a: Pick<TeamSceneActor, 'role'>): RoleArt =>
    a.role === 'lead'
      ? style.roles.lead
      : a.role === 'advisor'
        ? (style.roles.advisor ?? style.roles.member)
        : style.roles.member
  const feetOf = (art: RoleArt) => art.feet ?? { x: art.frame.width / 2, y: art.frame.height }
  const sheetPxAt = (art: RoleArt, depth: number): number =>
    (art.size / art.frame.height) * depthScale(depth)

  const drawStations = (g: CanvasRenderingContext2D, f: TeamSceneFrame): void => {
    const station = style.props?.station
    if (station === undefined) {
      return
    }
    const prop = image(station)
    const feet = style.props?.stationFeet ?? { x: prop.width / 2, y: prop.height }
    for (const spot of f.stations) {
      const px = sheetPxAt(style.roles.member, spot.depth)
      g.drawImage(
        prop,
        spot.x * f.width - feet.x * px,
        feetY(spot.depth, f.height) - feet.y * px,
        prop.width * px,
        prop.height * px
      )
    }
  }

  const sheetOf = (art: RoleArt, a: TeamScenePortraitSubject): TeamSceneArtImage =>
    image(art.sheets[figureSeedOf(a.characterKey ?? a.key) % art.sheets.length]!)

  // Why these fractions: Quest's figures stand about 0.75 of a frame tall, head in the top 0.44.
  const portrait = (g: CanvasRenderingContext2D, a: TeamScenePortraitSubject, size: number) => {
    const art = roleOf(a)
    const feet = feetOf(art)
    const side = Math.round(art.frame.height * PORTRAIT_SIDE)
    const top = Math.max(0, Math.round(feet.y - art.frame.height * PORTRAIT_TOP))
    const left = Math.min(Math.max(0, Math.round(feet.x - side / 2)), art.frame.width - side)
    const idle = art.animations.idle
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(
      sheetOf(art, a),
      left,
      idle.row * art.frame.height + top,
      side,
      side,
      0,
      0,
      size,
      size
    )
  }

  const drawActor = (g: CanvasRenderingContext2D, a: TeamSceneActor, f: TeamSceneFrame): void => {
    const art = roleOf(a)
    const px = sheetPxAt(art, a.depth)
    const feet = feetOf(art)
    const x = a.x * f.width
    const y = feetY(a.depth, f.height)
    const drawnHeight = art.frame.height * px
    const drawnWidth = art.frame.width * px
    g.fillStyle = a.emote === 'alert' ? colors.attention : 'rgb(20 20 30 / 0.4)'
    g.globalAlpha = a.emote === 'alert' ? 0.6 : 1
    g.beginPath()
    g.ellipse(x, y + 1, drawnHeight * SHADOW_WIDTH, drawnHeight * 0.05, 0, 0, TAU)
    g.fill()
    g.globalAlpha = 1
    // Why: a station is drawn one way, so whoever sits at it faces the way the art does.
    const seated =
      a.pose !== 'walk' && f.stations.some((spot) => Math.abs((a.x - spot.x) * f.width) < SEAT_PX)
    const [row, column] = frameOf(art, a, seated, f.t, px)
    g.save()
    g.translate(x, y - a.jump)
    g.scale(seated ? 1 : a.facing, 1)
    g.drawImage(
      sheetOf(art, a),
      column * art.frame.width,
      row * art.frame.height,
      art.frame.width,
      art.frame.height,
      -feet.x * px,
      -feet.y * px,
      drawnWidth,
      drawnHeight
    )
    g.restore()
    if (a.emote) {
      drawSceneEmote(g, x, y - a.jump - feet.y * px, a.emote, colors)
    }
  }

  return {
    height: TEAM_SCENE_ART_HEIGHT,
    portrait,
    headTop: (depth, h) => {
      const art = style.roles.lead
      return feetY(depth, h) - feetOf(art).y * sheetPxAt(art, depth)
    },
    paint: (g, f: TeamSceneFrame) => {
      const { width: w, height: h } = f
      g.drawImage(backdrop.get(w, h, f.ratio), 0, 0, w, h)
      effects.start(f.effects, f.actors, h)
      drawStations(g, f)
      for (const a of f.actors) {
        drawActor(g, a, f)
      }
      if (hasForeground) {
        g.drawImage(foreground.get(w, h, f.ratio), 0, 0, w, h)
      }
      effects.draw(g, f)
      drawSceneOverflow(g, f.overflow)
    },
    // Why only caches: the images go with the painter, and StrictMode disposes one it keeps.
    dispose: () => {
      backdrop.clear()
      foreground.clear()
      effects.clear()
    }
  }
}
