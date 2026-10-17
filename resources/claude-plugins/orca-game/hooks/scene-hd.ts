import { actionPixel } from './action-props'
import { localizedNameOf } from './game-strings'
import { landAtNight, NOON, type Daylight } from './hd-daylight'
import { costumeSpriteOf, hdSpritePixel } from './hd-sprite'
import { mix, UPPER_HALF } from './pixel-canvas'
import type { Action, FlowPhase } from './quest-policy'
import {
  bubbleTextOf,
  isReacting,
  paintBubble,
  paintFinale,
  reactionSaysOf,
  snoreOf,
  type Reaction
} from './scene'
import type { AdvisorPose } from './scene-cast'
import {
  hdFarPixel,
  hdFrameOf,
  hdGroundPixel,
  hdMidPixel,
  hdPlantPixel,
  hdPondPixel,
  hdSkyPixel
} from './scene-hd-land'
import type { SceneDefinition } from './scenes/index'
import { CLAWD_TOP } from './walk-path'

// The 2D-HD scene: 9 or 10 rows at native resolution, outlined and shaded characters on a lit landscape.

export const HD_ROWS = 9
export const HD_MAX_ROWS = 10
/** A costume is 10 columns; its outline adds one on each side. */
export const HD_SPRITE_WIDTH = 12

export type HdSceneInput = {
  scene: SceneDefinition
  phase: FlowPhase | undefined
  columns: number
  rows: number
  tick: number
  caption: string
  since: number
  reaction?: Reaction
  isResting?: boolean
  action?: Action
  advisor?: AdvisorPose
  light?: Daylight
}

/** 9 rows, 10 once the terminal is tall enough to spare them. */
export const hdRowsOf = (viewportRows: number | undefined): number => {
  const third = Math.max(12, Math.min(16, Math.round((viewportRows ?? 0) / 3.5)))
  return Math.min(HD_MAX_ROWS, Math.round(5 + (third - 5) / 2))
}

export const hdWalkColumn = (width: number, tick: number): number => {
  const span = Math.max(1, width - HD_SPRITE_WIDTH - 8)
  const step = Math.floor(tick / 2) % (span * 2)
  return step < span ? step : span * 2 - step
}

export const hdRestColumnOf = (width: number): number =>
  Math.max(0, Math.floor((width - HD_SPRITE_WIDTH) / 3))

const SHADOW = 0.38

export const hdSceneGridOf = (input: HdSceneInput): number[][] => {
  const { scene, columns, rows, tick } = input
  const reaction = isReacting(input.reaction) ? input.reaction : undefined
  const resting = input.isResting === true && reaction === undefined
  const light = input.light ?? NOON
  const look = scene.looks[input.phase ?? 'working']
  const costume = scene.costumes[input.phase ?? 'working']
  const frame = hdFrameOf({ look, width: columns, rows, tick, scroll: resting ? 0 : tick, light })
  const { ground, pixels } = frame
  const sprite = costumeSpriteOf(costume, Math.floor(tick / 4), resting)
  const walk = resting ? hdRestColumnOf(columns) : hdWalkColumn(columns, tick)
  const lift = reaction !== undefined && reaction.age % 6 < 3 ? 2 : 0
  const bob = resting ? (tick % 32 < 16 ? 0 : 1) : Math.floor(tick / 2) % 2
  const top = ground - sprite.rows.length + 1 - lift - bob
  const shown = resting ? undefined : input.action
  const characterLight = { night: frame.light.night * 0.5, dusk: frame.light.dusk }
  const at = (x: number, y: number): number => {
    const prop = actionPixel(shown, x - walk - HD_SPRITE_WIDTH + 1, CLAWD_TOP + (y - top - 1), tick)
    if (prop !== undefined) {
      return prop
    }
    const hero = hdSpritePixel(sprite, x, y, walk, top)
    if (hero !== undefined) {
      return landAtNight(hero, characterLight)
    }
    const pond = hdPondPixel(frame, x, y)
    if (pond !== undefined) {
      return pond
    }
    if (y >= ground) {
      const isShadow = y === ground && x > walk && x < walk + HD_SPRITE_WIDTH - 1 && lift === 0
      const soil = hdGroundPixel(frame, x, y)
      return landAtNight(isShadow ? mix(soil, 0x000000, SHADOW) : soil, frame.light)
    }
    const land = hdPlantPixel(frame, x, y) ?? hdMidPixel(frame, x, y) ?? hdFarPixel(frame, x, y)
    return land === undefined ? hdSkyPixel(frame, x, y) : landAtNight(land, frame.light)
  }
  const grid: number[][] = []
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      grid.push([UPPER_HALF, at(x, row * 2), at(x, Math.min(pixels - 1, row * 2 + 1))])
    }
  }
  const said =
    reaction !== undefined ? reactionSaysOf(reaction.kind) : resting ? snoreOf(tick) : input.caption
  const typedSince =
    reaction !== undefined ? tick - reaction.age : resting ? -Infinity : input.since
  const room = Math.max(1, Math.min(columns - 8, columns - 4))
  const text = ` ${bubbleTextOf(said, tick, typedSince, room)} `
  const left = Math.max(0, Math.min(columns - text.length - 2, walk + HD_SPRITE_WIDTH - 2))
  if (text.length + 2 <= columns) {
    paintBubble(grid, left + columns, text)
  }
  if (shown === 'merge' && scene.finale !== undefined) {
    paintFinale(grid, columns, localizedNameOf(scene.finale), rows)
  }
  return grid
}
