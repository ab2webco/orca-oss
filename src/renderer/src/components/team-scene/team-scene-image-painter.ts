import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import { teamSceneScaleAt } from '../../../../shared/team-scene/team-scene-motion'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { figureSeedOf } from './team-scene-figure-looks'
import { drawImagePortrait } from './team-scene-image-portrait'
import type {
  TeamSceneFrame,
  TeamScenePainter,
  TeamScenePortraitSubject
} from './team-scene-painter'
import {
  createSceneBackdrop,
  createSceneEffects,
  drawActorMarks,
  drawSceneOverflow,
  type TeamSceneStatusColors
} from './team-scene-painter-marks'
import { drawCastleBuilds } from './team-scene-castle-sites'
import { drawOfficeBuilds, officeSceneEffects } from './team-scene-office-builds'
import { officeVirusShakeAt } from './team-scene-office-virus'
import {
  drawOfficeBack,
  createOfficeBackLooks,
  deskSeatXOf,
  OFFICE_BACK_LAYOUT,
  officeBackEmoteAt,
  type OfficeBackSeat
} from './team-scene-office-back'
import {
  createStationBoots,
  drawStationScreen,
  stationFailingAt,
  stationScreenRectAt,
  stationScreenStateOf
} from './team-scene-station-screen'

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
const [NARROW_WIDTH, NARROW_SCALE] = [360, 0.92]
const BEHIND_ROW = 0.05
const SHADOW_WIDTH = 0.2
const feetY = (depth: number, h: number): number => h - 36 + depth * 22
// Why against the front: `size` is the drawn height at the front of the stage.
const depthScale = (depth: number): number => teamSceneScaleAt(depth) / teamSceneScaleAt(1)

/** One layer drawn to cover the stage from its bottom edge, centered across it, `shift` px over. */
function coverStage(
  g: CanvasRenderingContext2D,
  image: TeamSceneArtImage,
  w: number,
  h: number,
  shift = 0
): void {
  const scale = Math.max(w / image.width, h / image.height)
  const drawn = { width: image.width * scale, height: image.height * scale }
  const left = (w - drawn.width) / 2
  if (shift === 0) {
    g.drawImage(image, left, h - drawn.height, drawn.width, drawn.height)
    return
  }
  // Why two copies: the layer wraps, so its tail fills the gap its head leaves.
  const offset = ((shift % drawn.width) + drawn.width) % drawn.width
  for (const x of [left + offset, left + offset - drawn.width]) {
    g.drawImage(image, x, h - drawn.height, drawn.width, drawn.height)
  }
}

type Layer = OrchestratorGameSceneNativeStyle['layers'][number]
type Backdrop = ReturnType<typeof createSceneBackdrop>

/** Layers back to front: runs of still ones baked once, drifting ones drawn on the clock. */
function createLayerStack(layers: Layer[], image: (src: string) => TeamSceneArtImage) {
  const parts: ({ drift: number; src: string } | Backdrop)[] = []
  let still: Layer[] = []
  const bake = (): void => {
    const run = still
    if (run.length > 0) {
      parts.push(
        createSceneBackdrop((g, w, h) => run.forEach((one) => coverStage(g, image(one.src), w, h)))
      )
    }
    still = []
  }
  for (const layer of layers) {
    if (layer.drift) {
      bake()
      parts.push({ drift: layer.drift, src: layer.src })
    } else {
      still.push(layer)
    }
  }
  bake()
  return {
    draw: (g: CanvasRenderingContext2D, f: TeamSceneFrame): void => {
      for (const part of parts) {
        if ('drift' in part) {
          coverStage(g, image(part.src), f.width, f.height, part.drift * f.t)
        } else {
          g.drawImage(part.get(f.width, f.height, f.ratio), 0, 0, f.width, f.height)
        }
      }
    },
    clear: (): void => {
      for (const part of parts) {
        if (!('drift' in part)) {
          part.clear()
        }
      }
    }
  }
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
  /** What each working member builds beside its station; null draws the stations alone. */
  builds: 'castle' | 'office' | null
  /** Seated members drawn from behind at a desk whose own chair is dropped; null keeps the art's. */
  back?: OfficeBackSeat | null
}): TeamScenePainter {
  const { style, images } = args.art
  const { colors } = args
  const image = (src: string): TeamSceneArtImage => images.get(src)!
  const backdrop = createLayerStack(
    style.layers.filter((one) => !one.front),
    image
  )
  const foreground = createLayerStack(
    style.layers.filter((one) => one.front),
    image
  )
  const effects = createSceneEffects(feetY)
  const boots = createStationBoots()
  const roleOf = (a: Pick<TeamSceneActor, 'role'>): RoleArt =>
    a.role === 'lead'
      ? style.roles.lead
      : a.role === 'advisor'
        ? (style.roles.advisor ?? style.roles.member)
        : style.roles.member
  const feetOf = (art: RoleArt) => art.feet ?? { x: art.frame.width / 2, y: art.frame.height }
  // Why: below 360 px five desks touch; a slightly smaller row keeps a gap (set on each paint).
  let narrow = 1
  const sheetPxAt = (art: RoleArt, depth: number): number =>
    (art.size / art.frame.height) * depthScale(depth) * narrow

  const back = args.back ?? null
  const screen = style.props?.stationScreen
  const seatX = (prop: TeamSceneArtImage): number => deskSeatXOf(prop, style.props, back)
  const station = style.props?.station
  const monitorFromSeat = (depth: number): number =>
    station && screen
      ? (screen.x + screen.width / 2 - seatX(image(station))) * sheetPxAt(style.roles.member, depth)
      : 0

  const drawStations = (g: CanvasRenderingContext2D, f: TeamSceneFrame): void => {
    if (station === undefined) {
      return
    }
    const prop = image(station)
    const feet = { x: seatX(prop), y: style.props?.stationFeet?.y ?? prop.height }
    for (const spot of f.stations) {
      const px = sheetPxAt(style.roles.member, spot.depth)
      const failing = stationFailingAt(f, spot, SEAT_PX)
      const virus = failing && args.builds === 'office'
      const left = spot.x * f.width - feet.x * px + (virus ? officeVirusShakeAt(f.t, px) : 0)
      const top = feetY(spot.depth, f.height) - feet.y * px
      if (back) {
        const [from, sw, h] = [back.chairEnd, prop.width - back.chairEnd, prop.height]
        g.drawImage(prop, from, 0, sw, h, left + from * px, top, sw * px, h * px)
      } else {
        g.drawImage(prop, left, top, prop.width * px, prop.height * px)
      }
      if (screen) {
        const worker = f.actors.find(
          (a) =>
            a.role === 'member' && a.pose !== 'walk' && Math.abs((a.x - spot.x) * f.width) < SEAT_PX
        )
        const rect = stationScreenRectAt(screen, left, top, px)
        const state = stationScreenStateOf(worker?.pose ?? null, failing, worker?.play)
        const boot = boots.progressOf(worker?.key, f.t)
        drawStationScreen(g, rect, state, f.t, { attention: colors.attention, virus, boot })
      }
    }
  }

  const sheetOf = (art: RoleArt, a: TeamScenePortraitSubject): TeamSceneArtImage =>
    image(art.sheets[figureSeedOf(a.characterKey ?? a.key) % art.sheets.length]!)
  const backLookOf = createOfficeBackLooks()

  const portrait = (g: CanvasRenderingContext2D, a: TeamScenePortraitSubject, size: number) =>
    drawImagePortrait(g, roleOf(a), sheetOf(roleOf(a), a), size)

  const seatedAt = (a: TeamSceneActor, f: Pick<TeamSceneFrame, 'width' | 'stations'>): boolean =>
    a.pose !== 'walk' && f.stations.some((spot) => Math.abs((a.x - spot.x) * f.width) < SEAT_PX)
  const emoteAt: NonNullable<TeamScenePainter['emoteAt']> = (a, f) =>
    back && a.role === 'member' && seatedAt(a, f)
      ? officeBackEmoteAt(a, a.x * f.width, feetY(a.depth, f.height), sheetPxAt(roleOf(a), a.depth))
      : null

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
    const seated = seatedAt(a, f)
    const beside = emoteAt(a, f)
    if (beside) {
      drawOfficeBack(g, x, y, px, backLookOf(sheetOf(art, a), art.frame), a, f.t + a.x * 7)
      drawActorMarks(g, beside.x, beside.y, a, colors)
      return
    }
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
    drawActorMarks(g, x, y - a.jump - feet.y * px, a, colors)
  }

  return {
    height: TEAM_SCENE_ART_HEIGHT,
    ...(back ? { layout: OFFICE_BACK_LAYOUT, emoteAt } : {}),
    portrait,
    headTop: (depth, h) => {
      const art = style.roles.lead
      return feetY(depth, h) - feetOf(art).y * sheetPxAt(art, depth)
    },
    paint: (g, f: TeamSceneFrame) => {
      const h = f.height
      narrow = back && f.width < NARROW_WIDTH ? NARROW_SCALE : 1
      backdrop.draw(g, f)
      const shown =
        args.builds === 'office' ? boots.take(officeSceneEffects(f.effects), f.t) : f.effects
      effects.start(shown, f.actors, h)
      if (args.builds === 'castle') {
        drawCastleBuilds(g, f, feetY)
      } else if (args.builds === 'office') {
        drawOfficeBuilds(g, f, feetY, colors.attention, monitorFromSeat, !back)
      }
      // Why split: whoever walks behind the row goes under its monitors, never over them; a
      // gesturing advisor stands in a gap, clear of every monitor, so it shows in front.
      const row = Math.min(...f.stations.map((s) => s.depth)) - BEHIND_ROW
      const behind = (a: TeamSceneActor) => a.depth < row && !a.gesture
      f.actors.filter(behind).forEach((a) => drawActor(g, a, f))
      drawStations(g, f)
      f.actors.filter((a) => !behind(a)).forEach((a) => drawActor(g, a, f))
      foreground.draw(g, f)
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
