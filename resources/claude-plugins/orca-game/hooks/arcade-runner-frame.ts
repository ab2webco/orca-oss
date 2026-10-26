import {
  runnerHeightOf,
  HERO_LEFT,
  type Runner,
  type RunnerShape,
  type RunnerState
} from './arcade-runner'
import type { ArcadeRunner } from './arcade-runner-data'
import { hdFloorPixel } from './hd-backdrop'
import { landInLight, MIDNIGHT, NOON, type Daylight } from './hd-daylight'
import { hdBakedGroundOf, hdBakedLandOf, hdLandBakeOf } from './hd-land-bake'
import { lightnessOf } from './hd-lightness'
import { figureEdgeOf } from './hd-readability'
import {
  costumeSpriteOf,
  frameSpriteOf,
  hdSpritePixel,
  isHdHaloAt,
  type HdSprite
} from './hd-sprite'
import { glyphCell, mix, UPPER_HALF } from './pixel-canvas'
import { hdFrameOf } from './scene-hd-land'
import { hdPlantShapePixel, PLANT_EVERY } from './scene-hd-props'
import { hdSkyPixel } from './scene-hd-sky'
import { rasterGlyphsOf } from './game-strings'
import type { Costume, Look, SceneDefinition } from './scenes/index'

// The runner drawn as an hd band of the active scene: its sky, far range, hills and ground behind,
// its own decoration as obstacles, a costume as the hero. The backdrop's scattered plants and pond
// are left out, since anything on the ground line reads as something to jump.

/** A scene decoration is cut to this so a timed jump clears it at max speed (see HERO_HITBOX). */
export const ARCADE_SHAPE_MAX_HEIGHT = 4
export const ARCADE_SHAPE_MAX_COLUMNS = 5
/** Room for the hero's peak under the score: 3 ground pixels, a 9-pixel hero and an 8-pixel jump. */
export const ARCADE_ROWS = 12
const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const PLANT_MAX_HEIGHT = 16
const SHADOW = 0.38

export type ArcadeShape = RunnerShape & {
  /** The colour `h` pixels above the ground in the shape's `column`, unlit. */
  pixelAt: (column: number, h: number, tick: number) => number | undefined
  /** Drawn outlined like a character, so it parts from a land of its own colour. */
  sprite: HdSprite
}

const shapeOf = (
  weight: number,
  columns: number,
  height: number,
  pixelAt: ArcadeShape['pixelAt']
): ArcadeShape => {
  const heights = Array.from({ length: columns }, (_, column) => {
    let top = 0
    for (let h = 0; h < height; h += 1) {
      if (pixelAt(column, h, 0) !== undefined) {
        top = h + 1
      }
    }
    return top
  })
  const colors: Record<string, number> = {}
  const glyphOf = new Map<number, string>()
  const rows = Array.from({ length: height }, (_, row) =>
    heights
      .map((_, column) => {
        const color = pixelAt(column, height - 1 - row, 0)
        if (color === undefined) {
          return '.'
        }
        const glyph = glyphOf.get(color) ?? GLYPHS[glyphOf.size % GLYPHS.length] ?? 'z'
        glyphOf.set(color, glyph)
        colors[glyph] = color
        return glyph
      })
      .join('')
  )
  return { heights, weight, pixelAt, sprite: frameSpriteOf(rows, colors) }
}

// Why drop empty columns first: a flower's two stems sit eight columns apart.
const sceneShapeOf = (look: Look, weight: number): ArcadeShape | undefined => {
  const slots: number[] = []
  let natural = 0
  for (let slot = 0; slot < PLANT_EVERY; slot += 1) {
    for (let h = 0; h < PLANT_MAX_HEIGHT; h += 1) {
      if (hdPlantShapePixel(look, slot, h, 0) !== undefined) {
        natural = Math.max(natural, h + 1)
        if (slots.at(-1) !== slot) {
          slots.push(slot)
        }
      }
    }
  }
  if (slots.length === 0) {
    return undefined
  }
  const columns = Math.min(ARCADE_SHAPE_MAX_COLUMNS, slots.length)
  const height = Math.min(ARCADE_SHAPE_MAX_HEIGHT, natural)
  return shapeOf(weight, columns, height, (column, h, tick) => {
    // Why each column's middle: a tree's trunk is its centre slot, and an edge sample skips it.
    const slot = slots[Math.floor(((column + 0.5) * slots.length) / columns)]
    return slot === undefined || column >= columns || h >= height
      ? undefined
      : // Why to the top: an antenna's beacon and a crystal's tip are what make it read as one.
        hdPlantShapePixel(
          look,
          slot,
          height === 1 ? 0 : Math.round((h * (natural - 1)) / (height - 1)),
          tick
        )
  })
}

/** The game's obstacles for this look; `{ from: 'scene' }` drops out when the look has no decoration. */
export const arcadeShapesOf = (game: ArcadeRunner, look: Look): ArcadeShape[] =>
  game.obstacles.flatMap((one) => {
    if ('from' in one) {
      return sceneShapeOf(look, one.weight) ?? []
    }
    const { rows, colors } = one
    const width = rows[0]?.length ?? 0
    return shapeOf(one.weight, width, rows.length, (column, h) => {
      const glyph = rows[rows.length - 1 - h]?.[column]
      return glyph === undefined || glyph === '.' ? undefined : colors[glyph]
    })
  })

export type ArcadeFrameInput = {
  scene: SceneDefinition
  runner: Runner<ArcadeShape>
  state: RunnerState
  columns: number
  rows: number
  tick: number
  /** The member who earned the play; the scene's working costume when absent. */
  costume?: Costume
  light?: Daylight
  /** A line over the sky (paused, game over), centred. */
  caption?: string
}

const textInto = (grid: number[][], columns: number, row: number, left: number, text: string) => {
  rasterGlyphsOf(text).forEach((glyph, i) => {
    const x = left + i
    const cell = grid[row * columns + x]
    if (x < 0 || x >= columns || cell === undefined) {
      return
    }
    const back = cell[1] ?? 0
    grid[row * columns + x] = glyphCell(glyph, lightnessOf(back) > 55 ? 0x101010 : 0xf4f4f4, back)
  })
}

export const arcadeGridOf = (input: ArcadeFrameInput): number[][] => {
  const { scene, runner, state, columns, rows, tick } = input
  const look = scene.looks.working
  const light = input.light ?? (look.isNight ? MIDNIGHT : NOON)
  const frame = hdFrameOf({
    look,
    width: columns,
    rows,
    tick,
    scroll: Math.floor(state.distance),
    light
  })
  const { ground, pixels } = frame
  const land = hdLandBakeOf(frame)
  const lift = Math.round(runnerHeightOf(runner, state))
  const legs = lift > 0 || state.isOver ? 0 : Math.floor(state.distance / 2)
  const sprite = costumeSpriteOf(input.costume ?? scene.costumes.working, legs, false)
  const top = ground - sprite.rows.length + 1 - lift
  const figureLight = look.isNight ? NOON : { ...frame.light, night: frame.light.night * 0.5 }
  // Front to back: the hero, then each obstacle, its outline's bottom on the ground like the hero's.
  const placed: { sprite: HdSprite; left: number; top: number }[] = [
    { sprite, left: HERO_LEFT, top },
    ...state.obstacles.flatMap((one) => {
      const shape = runner.shapes[one.shape]
      return shape === undefined
        ? []
        : [
            {
              sprite: shape.sprite,
              left: Math.round(one.x - state.distance) - 1,
              top: ground - shape.sprite.rows.length + 1
            }
          ]
    })
  ]
  const backdropAt = (x: number, y: number): number => {
    if (y < ground) {
      return hdBakedLandOf(land, frame, x, y) ?? hdSkyPixel(frame, x, y)
    }
    if (y > ground) {
      return hdBakedGroundOf(land, frame, x, y)
    }
    const isUnder = lift === 0 && x > HERO_LEFT && x < HERO_LEFT + sprite.width - 1
    return mix(hdFloorPixel(frame, land, x), 0x000000, isUnder ? SHADOW : 0)
  }
  const at = (x: number, y: number): number => {
    for (const one of placed) {
      const color = hdSpritePixel(one.sprite, x, y, one.left, one.top)
      if (color !== undefined) {
        return landInLight(color, figureLight)
      }
    }
    const behind = backdropAt(x, y)
    if (y > ground) {
      return behind
    }
    const rimmed = placed.find((one) => isHdHaloAt(one.sprite, x, y, one.left, one.top))
    if (rimmed === undefined) {
      return behind
    }
    const ink = landInLight(rimmed.sprite.outline, figureLight)
    return figureEdgeOf(ink, behind, look) === ink ? behind : figureEdgeOf(ink, behind, look)
  }
  const grid: number[][] = []
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      grid.push([UPPER_HALF, at(x, row * 2), at(x, Math.min(pixels - 1, row * 2 + 1))])
    }
  }
  const score = String(state.score)
  textInto(grid, columns, 0, columns - score.length - 1, score)
  if (input.caption !== undefined) {
    textInto(grid, columns, 1, Math.floor((columns - input.caption.length) / 2), input.caption)
  }
  return grid
}
