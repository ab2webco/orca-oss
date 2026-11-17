import {
  characterCostumeOf,
  stewardCostumeOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/character-look'
import { createVerdictFlights } from './team-scene-verdict-flights'
import { hdBackdropPixel } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-backdrop'
import type { Daylight } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import { hdLandBakeOf } from '../../../../../resources/claude-plugins/orca-game/hooks/hd-land-bake'
import {
  crownAtOf,
  crownPixel
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-party'
import {
  costumeSpriteOf,
  hdSpritePixel,
  type HdSprite
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-sprite'
import { hdFrameOf } from '../../../../../resources/claude-plugins/orca-game/hooks/scene-hd-land'
import { hdSkyPixel } from '../../../../../resources/claude-plugins/orca-game/hooks/scene-hd-sky'
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import { PILE_FROM_SEAT_X, SITE_FROM_SEAT_X } from '../../../../shared/team-scene/team-scene-sites'
import { pixelAdvisorSpriteOf, pixelPetOf } from './team-scene-pixel-cast'
import { drawPixelProp } from './team-scene-pixel-prop'
import {
  drawPixelCrates,
  drawPixelPlot,
  drawPixelSack,
  gardenPaletteOf
} from './team-scene-pixel-garden'
import type {
  TeamSceneFrame,
  TeamScenePainter,
  TeamScenePortraitSubject
} from './team-scene-painter'
import {
  createSceneEffects,
  drawActorMarks,
  drawSceneOverflow,
  type TeamSceneStatusColors
} from './team-scene-painter-marks'

/** CSS px per scene pixel: integer, so every sprite pixel lands on whole device pixels. */
const PIXEL = 3
const ROWS = 21
const PIXELS = ROWS * 2
const HEIGHT = PIXELS * PIXEL
// The hd frame keeps its bottom three pixel rows as the walking strip.
const GROUND = PIXELS - 3
const feetRow = (depth: number): number => GROUND - 2 + Math.round(depth * 2)
// Columns from a seat to its bed's middle: half a sprite, a gap, half the bed.
const BED_FROM_SEAT = 9

// The game's SCENE_TICK_MS; its clouds and stars change at most every 6 ticks, so the sky rebakes then.
const TICK_MS = 120
const SKY_TICKS = 6

const hex = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`

function bitmapOf(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => number | undefined,
  /** Repainted in place when its size matches, so a moving sky makes no new canvas each step. */
  reuse?: HTMLCanvasElement
): HTMLCanvasElement {
  const canvas =
    reuse?.width === width && reuse.height === height ? reuse : document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  g?.clearRect(0, 0, width, height)
  for (let y = 0; g && y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorAt(x, y)
      if (color !== undefined) {
        g.fillStyle = hex(color)
        g.fillRect(x, y, 1, 1)
      }
    }
  }
  return canvas
}

/** The Pixel style: the game's own scene, sprites and crown, placed by the shared simulation. */
export function createPixelPainter(args: {
  scene: SceneDefinition
  light: Daylight
  colors: TeamSceneStatusColors
}): TeamScenePainter {
  const { scene, light, colors } = args
  // Why the scene's own look: a file scene's garden must match its palette, not Quest's.
  const garden = gardenPaletteOf(scene.looks.working.plant, scene.looks.working.sun)
  let backdrop: { columns: number; step: number; canvas: HTMLCanvasElement } | null = null
  let sprites = new WeakMap<HdSprite, Map<string, HTMLCanvasElement>>()
  const effects = createSceneEffects((depth) => feetRow(depth) * PIXEL)
  const verdicts = createVerdictFlights((depth) => feetRow(depth) * PIXEL, colors)
  const steward = stewardCostumeOf(scene)

  const backdropFor = (columns: number, t: number): HTMLCanvasElement => {
    const step = Math.floor((t * 1000) / TICK_MS / SKY_TICKS)
    if (backdrop?.columns !== columns || backdrop.step !== step) {
      const look = scene.looks.working
      const at = (tick: number) =>
        hdFrameOf({ look, width: columns, rows: ROWS, tick, scroll: 0, light })
      const still = at(0)
      const moving = at(step * SKY_TICKS)
      const land = hdLandBakeOf(still)
      // Why only the sky moves: the far range's windows flicker on the tick too, and a done
      // agent standing before them must hold still.
      const colorAt = (x: number, y: number): number => {
        const color = hdBackdropPixel(still, land, x, y)
        return color === hdSkyPixel(still, x, y) ? hdSkyPixel(moving, x, y) : color
      }
      backdrop = { columns, step, canvas: bitmapOf(columns, PIXELS, colorAt, backdrop?.canvas) }
    }
    return backdrop.canvas
  }

  // Why cached per sprite object: the mod returns the same sprite for a costume and leg frame.
  const spriteFor = (sprite: HdSprite, crowned: boolean): HTMLCanvasElement => {
    const key = crowned ? 'crown' : 'plain'
    const own = sprites.get(sprite) ?? new Map<string, HTMLCanvasElement>()
    sprites.set(sprite, own)
    const kept = own.get(key)
    if (kept) {
      return kept
    }
    const lift = crowned ? 3 : 0
    const crown = crownAtOf(sprite.rows, 0, lift)
    const made = bitmapOf(
      sprite.width,
      sprite.rows.length + lift,
      (x, y) =>
        (crowned ? crownPixel(x, y, crown.left, crown.top) : undefined) ??
        hdSpritePixel(sprite, x, y, 0, lift)
    )
    own.set(key, made)
    return made
  }

  const imageOf = (
    a: TeamScenePortraitSubject & Pick<TeamSceneActor, 'gesture'>,
    leg: number,
    t = 0
  ): HTMLCanvasElement => {
    const own = a.role === 'advisor' ? pixelAdvisorSpriteOf(scene, t, a.gesture) : null
    if (own) {
      return spriteFor(own, false)
    }
    const costume =
      a.role === 'steward'
        ? steward
        : characterCostumeOf(scene, a.role === 'advisor' ? undefined : a.name, 'working')
    return spriteFor(costumeSpriteOf(costume, leg, false), a.role === 'lead')
  }
  const blit = (
    g: CanvasRenderingContext2D,
    image: HTMLCanvasElement,
    left: number,
    bottom: number,
    facing: 1 | -1
  ): void => {
    g.save()
    g.translate(
      (left + (facing < 0 ? image.width : 0)) * PIXEL,
      (bottom - image.height + 1) * PIXEL
    )
    g.scale(facing * PIXEL, PIXEL)
    g.drawImage(image, 0, 0)
    g.restore()
  }
  const drawActor = (
    g: CanvasRenderingContext2D,
    a: TeamSceneActor,
    columns: number,
    t: number
  ): void => {
    const leg = a.pose === 'walk' ? Math.floor(a.gait / Math.PI) % 2 : 0
    const image = imageOf(a, leg, t)
    const left = Math.round(a.x * columns - image.width / 2)
    const bottom = feetRow(a.depth) - Math.round(a.jump / PIXEL)
    g.fillStyle = a.emote === 'alert' ? colors.attention : 'rgb(20 20 30 / 0.35)'
    g.fillRect((left + 1) * PIXEL, (feetRow(a.depth) + 1) * PIXEL, (image.width - 2) * PIXEL, PIXEL)
    blit(g, image, left, bottom, a.facing)
    const pet = a.role === 'lead' ? pixelPetOf(scene, a, left, image.width, t) : null
    if (pet) {
      blit(g, spriteFor(pet.sprite, false), pet.left, feetRow(a.depth), a.facing)
    }
    drawPixelProp({
      g,
      a,
      t,
      cx: left + Math.floor(image.width / 2),
      hy: bottom - Math.floor(image.height / 2),
      pixel: PIXEL,
      prop: scene.prop
    })
    const markX = (left + image.width / 2) * PIXEL
    drawActorMarks(g, markX, (bottom - image.height - 3) * PIXEL, a, colors)
  }

  return {
    height: HEIGHT,
    cloudPixel: PIXEL,
    headTop: (depth) => (feetRow(depth) - 10) * PIXEL,
    feetAt: (depth) => feetRow(depth) * PIXEL,
    portrait: (g, who, size) => {
      const image = imageOf(who, 0)
      const px = Math.max(1, Math.floor(size / Math.max(image.width, image.height)))
      const width = image.width * px
      const height = image.height * px
      g.imageSmoothingEnabled = false
      g.drawImage(image, Math.round((size - width) / 2), size - height, width, height)
    },
    paint: (g, f: TeamSceneFrame) => {
      const columns = Math.ceil(f.width / PIXEL)
      g.imageSmoothingEnabled = false
      g.drawImage(backdropFor(columns, f.t), 0, 0, columns * PIXEL, HEIGHT)
      drawPixelCrates(g, f.trophies.length, feetRow(0), PIXEL, garden)
      for (const site of f.sites) {
        const row = feetRow(site.spot.depth)
        // Why in columns: Pixel's sprites are ten wide, so the bed must clear the seat's own.
        const seat = Math.round((site.spot.x - SITE_FROM_SEAT_X) * columns)
        drawPixelSack(g, Math.round(seat - PILE_FROM_SEAT_X * columns), row, PIXEL)
        drawPixelPlot(g, seat + BED_FROM_SEAT, row, PIXEL, site, f.t, garden)
      }
      effects.start(f.effects, f.actors, f.height)
      verdicts.start(f.effects, f.actors)
      for (const a of f.actors) {
        // Why offset by x: members side by side swing out of step, as in Figures and Office.
        drawActor(g, a, columns, f.t + a.x * 7)
      }
      effects.draw(g, f)
      verdicts.draw(g, f)
      drawSceneOverflow(g, f.overflow)
    },
    dispose: () => {
      backdrop = null
      sprites = new WeakMap()
      effects.clear()
      verdicts.clear()
    }
  }
}
