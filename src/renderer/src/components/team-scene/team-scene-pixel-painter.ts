import { characterCostumeOf } from '../../../../../resources/claude-plugins/orca-game/hooks/character-look'
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
import type { SceneDefinition } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/scene-definition'
import type { TeamSceneActor } from '../../../../shared/team-scene/team-scene-types'
import type { TeamSceneFrame, TeamScenePainter } from './team-scene-painter'
import {
  createSceneEffects,
  drawSceneEmote,
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

const hex = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`

function bitmapOf(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => number | undefined
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
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
  let backdrop: { columns: number; canvas: HTMLCanvasElement } | null = null
  let sprites = new WeakMap<HdSprite, Map<string, HTMLCanvasElement>>()
  const effects = createSceneEffects((depth) => feetRow(depth) * PIXEL)

  const backdropFor = (columns: number): HTMLCanvasElement => {
    if (backdrop?.columns !== columns) {
      const look = scene.looks.working
      const frame = hdFrameOf({ look, width: columns, rows: ROWS, tick: 0, scroll: 0, light })
      const land = hdLandBakeOf(frame)
      backdrop = {
        columns,
        canvas: bitmapOf(columns, PIXELS, (x, y) => hdBackdropPixel(frame, land, x, y))
      }
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

  const drawActor = (g: CanvasRenderingContext2D, a: TeamSceneActor, columns: number): void => {
    const leg = a.pose === 'walk' ? Math.floor(a.gait / Math.PI) % 2 : 0
    const costume = characterCostumeOf(scene, a.role === 'advisor' ? undefined : a.name, 'working')
    const crowned = a.role === 'lead'
    const image = spriteFor(costumeSpriteOf(costume, leg, false), crowned)
    const left = Math.round(a.x * columns - image.width / 2)
    const bottom = feetRow(a.depth) - Math.round(a.jump / PIXEL)
    g.fillStyle = a.emote === 'alert' ? colors.attention : 'rgb(20 20 30 / 0.35)'
    g.fillRect((left + 1) * PIXEL, (feetRow(a.depth) + 1) * PIXEL, (image.width - 2) * PIXEL, PIXEL)
    g.save()
    g.translate(
      (left + (a.facing < 0 ? image.width : 0)) * PIXEL,
      (bottom - image.height + 1) * PIXEL
    )
    g.scale(a.facing * PIXEL, PIXEL)
    g.drawImage(image, 0, 0)
    g.restore()
    if (a.emote) {
      drawSceneEmote(
        g,
        (left + image.width / 2) * PIXEL,
        (bottom - image.height - 3) * PIXEL,
        a.emote,
        colors
      )
    }
  }

  return {
    height: HEIGHT,
    cloudPixel: PIXEL,
    headTop: (depth) => (feetRow(depth) - 10) * PIXEL,
    paint: (g, f: TeamSceneFrame) => {
      const columns = Math.ceil(f.width / PIXEL)
      g.imageSmoothingEnabled = false
      g.drawImage(backdropFor(columns), 0, 0, columns * PIXEL, HEIGHT)
      effects.start(f.effects, f.actors, f.height)
      for (const a of f.actors) {
        drawActor(g, a, columns)
      }
      effects.draw(g, f)
      drawSceneOverflow(g, f.overflow)
    },
    dispose: () => {
      backdrop = null
      sprites = new WeakMap()
      effects.clear()
    }
  }
}
