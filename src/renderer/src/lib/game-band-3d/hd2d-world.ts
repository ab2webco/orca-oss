// HD-2D world data from a scene's own hd art: layer silhouettes, lit palette and sprite images.
import {
  dayLiftOf,
  landInLight,
  type Daylight
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import {
  hdSpritePixel,
  type HdSprite
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-sprite'
import { mix } from '../../../../../resources/claude-plugins/orca-game/hooks/pixel-canvas'
import {
  hdFrameOf,
  hdPlantPixel
} from '../../../../../resources/claude-plugins/orca-game/hooks/scene-hd-land'
import { skyRowOf } from '../../../../../resources/claude-plugins/orca-game/hooks/scene-hd-sky'
import type {
  Look,
  SceneDefinition,
  ScenePhase
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'

/** Band rows the silhouettes are sampled at; one world unit is one hd pixel. */
export const WORLD_ROWS = 10
// The land's plant repeat and the tallest plant, in hd pixels.
const PLANT_EVERY = 19
const PLANT_ROWS = 12

export type Hd2dWorld = {
  look: Look
  pixels: number
  ground: number
  /** Sky gradient, one colour per hd pixel row from the top to the ground line. */
  sky: number[]
  /** Heights above the ground line, one per column. */
  far: { heights: Float32Array; color: number; snow: number }
  mid: { heights: Float32Array; color: number }
  grass: number
  soil: number
  /** One plant drawn from the land's own art, and the columns where the land puts one. */
  plants: { image: SpriteImage; lefts: number[] } | null
  sun: { color: number; x: number; y: number }
  night: number
}

export type SpriteImage = { width: number; height: number; rgba: Uint8ClampedArray }

const imageOf = (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => number | undefined
): SpriteImage => {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixelAt(x, y)
      if (color !== undefined) {
        rgba.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255], (y * width + x) * 4)
      }
    }
  }
  return { width, height, rgba }
}

const plantsOf = (
  frame: ReturnType<typeof hdFrameOf>,
  columns: number,
  lit: (color: number) => number
): Hd2dWorld['plants'] => {
  const lefts: number[] = []
  for (let left = 0; left + PLANT_EVERY <= columns; left += PLANT_EVERY) {
    const isPlanted = Array.from({ length: PLANT_EVERY }, (_, dx) => left + dx).some(
      (x) => hdPlantPixel(frame, x, frame.ground - 2) !== undefined
    )
    if (isPlanted) {
      lefts.push(left)
    }
  }
  const first = lefts[0]
  if (first === undefined) {
    return null
  }
  const top = frame.ground - PLANT_ROWS
  const image = imageOf(PLANT_EVERY, PLANT_ROWS, (x, y) => {
    const color = hdPlantPixel(frame, first + x, top + y)
    return color === undefined ? undefined : lit(color)
  })
  return { image, lefts }
}

export const hd2dWorldOf = (
  scene: SceneDefinition,
  columns: number,
  light: Daylight
): Hd2dWorld => {
  const look = scene.looks.working
  const frame = hdFrameOf({ look, width: columns, rows: WORLD_ROWS, tick: 0, scroll: 0, light })
  const lift = dayLiftOf(look)
  const lit = (color: number): number => landInLight(color, frame.light, lift, look.isNight)
  const far = new Float32Array(columns)
  const mid = new Float32Array(columns)
  for (let x = 0; x < columns; x += 1) {
    far[x] = frame.farTops[x + 1] ?? 0
    mid[x] = frame.ground - (frame.midTops[x] ?? frame.ground)
  }
  return {
    look,
    pixels: frame.pixels,
    ground: frame.ground,
    sky: Array.from({ length: frame.ground }, (_, y) => skyRowOf(frame, y)),
    far: { heights: far, color: lit(look.far), snow: lit(look.snow) },
    mid: { heights: mid, color: lit(mix(look.near, look.far, 0.35)) },
    grass: lit(mix(look.near, look.ground, 0.25)),
    soil: lit(look.ground),
    plants: plantsOf(frame, columns, lit),
    sun: { color: look.sun, x: frame.sunX, y: frame.sunY },
    night: frame.light.night
  }
}

/** The sprite's hd pixels as RGBA, transparent where it draws nothing. */
export const spriteImageOf = (sprite: HdSprite, ring?: number): SpriteImage =>
  imageOf(sprite.width, sprite.rows.length, (x, y) => hdSpritePixel(sprite, x, y, 0, 0, ring))

/** Which of the scene's costumes each member wears: the lead the working one, the rest in turn. */
export const castOf = (
  scene: SceneDefinition,
  members: readonly { key: string; isLead: boolean }[]
): Map<string, ScenePhase> => {
  const phases = (Object.keys(scene.costumes) as ScenePhase[]).filter((one) => one !== 'working')
  let next = 0
  return new Map(
    members.map((member) => {
      if (member.isLead || phases.length === 0) {
        return [member.key, 'working']
      }
      const phase = phases[next % phases.length] ?? 'working'
      next += 1
      return [member.key, phase]
    })
  )
}
