import { actionPixel } from './action-props'
import { gameStrings, localizedNameOf } from './game-strings'
import { cellsOf, glyphCell, hash, mix, mod, UPPER_HALF } from './pixel-canvas'
import type { Action, FlowPhase } from './quest-policy'
import { farPixel, GROUND, nearTopOf, plantPixel, sunPixel } from './scenery'
import {
  advisorPixel,
  advisorStageOf,
  castPixel,
  castWidthOf,
  petColumnOf,
  petFrameOf,
  type AdvisorPose
} from './scene-cast'
import type { Costume, Look, SceneDefinition } from './scenes/index'
import { CLAWD_TOP, restColumnOf, SPRITE_WIDTH, walkColumn } from './walk-path'

export const SCENE_ROWS = 5
export const SCENE_TICK_MS = 120
export const SCENE_KEY = 'orca-game-scene'
export { CLAWD_TOP, restColumnOf, SPRITE_WIDTH, walkColumn }
const MAX_COLUMNS = 512
const MARGIN = 2
const STAR = 0xf5f3c8
const BUBBLE = 0xf4f4f0
const BUBBLE_TEXT = 0x23232b
const HEART = 0xff5a8a
const FINALE_TEXT = 0xffffff
const FINALE_PANEL = 0x1a1a24
const ADVISOR_BUBBLE_MAX = 28

export const sceneColumnsOf = (viewport: number | undefined): number =>
  Math.max(1, Math.min(MAX_COLUMNS, (viewport ?? 80) - MARGIN))

const clawdPixel = (
  costume: Costume,
  x: number,
  y: number,
  tick: number,
  at: number,
  isResting: boolean
): number | undefined => {
  const column = x - at
  const top = CLAWD_TOP + (isResting ? 1 : 0)
  const last = top + costume.rows.length
  if (column < 0 || column >= SPRITE_WIDTH || y < top || y > last || (isResting && y === last)) {
    return undefined
  }
  const row = y === last ? costume.legs[Math.floor(tick / 2) % 2] : costume.rows[y - top]
  return costume.colors[row?.[column] ?? '.']
}

const skyPixel = (look: Look, width: number, x: number, y: number, tick: number): number => {
  const sun = sunPixel(look, width, x, y)
  if (sun !== undefined) {
    return sun
  }
  const blob = mod(x + Math.floor(tick / 10), 37)
  if ((y === 2 && blob >= 3 && blob <= 9) || (y === 1 && blob >= 5 && blob <= 7)) {
    return look.cloud
  }
  const twinkles = (hash(x, y) + Math.floor(tick / 5)) % 6 !== 0
  if (look.isNight && y <= 5 && hash(x, y) % 29 === 0 && twinkles) {
    return STAR
  }
  return mix(look.skyTop, look.skyBottom, y / (GROUND - 1))
}

const landscapePixel = (
  look: Look,
  width: number,
  x: number,
  y: number,
  tick: number,
  isResting: boolean
): number => {
  const scroll = isResting ? 0 : tick
  if (y === GROUND) {
    return hash(x + scroll, 7) % 9 === 0 ? mix(look.ground, 0x000000, 0.25) : look.ground
  }
  const nx = x + Math.floor(scroll / 2)
  const hill = nearTopOf(look, nx)
  if (y >= hill) {
    return mix(look.near, 0x000000, (y - hill) * 0.08)
  }
  return (
    plantPixel(look, nx, y, hill) ??
    farPixel(look, x + Math.floor(scroll / 6), y, tick) ??
    skyPixel(look, width, x, y, tick)
  )
}

export const paintBubble = (grid: number[][], left: number, text: string): void => {
  const right = left + text.length + 1
  const skyAt = (x: number) => grid[x]?.[1] ?? 0
  grid[left] = [0x2590, BUBBLE, skyAt(left)]
  Array.from(text).forEach((glyph, index) => {
    grid[left + 1 + index] = glyphCell(glyph, BUBBLE_TEXT, BUBBLE)
  })
  grid[right] = [0x258c, BUBBLE, skyAt(right)]
}

const DOTS = ['.  ', '.. ', '...'] as const

export const REACTION_TICKS = 24

export type Reaction = { kind: 'pet' | 'hello' | 'level'; age: number }

export const reactionSaysOf = (kind: Reaction['kind']): string => {
  const art = gameStrings().art
  return kind === 'pet' ? art.thanks : kind === 'hello' ? art.onIt : art.levelUp
}

const SNORES = ['z  ', 'zz ', 'zzz'] as const

export const snoreOf = (tick: number): string => SNORES[Math.floor(tick / 5) % SNORES.length] ?? ''

export const isReacting = (reaction: Reaction | undefined): reaction is Reaction =>
  reaction !== undefined && reaction.age >= 0 && reaction.age < REACTION_TICKS

export const bubbleTextOf = (
  caption: string,
  tick: number,
  since: number,
  room: number
): string => {
  const thinking = `${gameStrings().art.thinking}${DOTS[Math.floor(tick / 4) % DOTS.length]}`
  const said = caption === '' ? thinking : caption
  const fitted = said.length <= room ? said : `${said.slice(0, Math.max(0, room - 1))}…`
  // A caption types itself in, three letters a tick.
  const shown = caption === '' ? fitted.length : Math.max(1, (tick - since) * 3)
  return fitted.slice(0, shown).padEnd(fitted.length, ' ')
}

const sprinkle = (
  grid: number[][],
  offsets: readonly number[],
  from: number,
  span: number,
  glyph: number,
  color: number,
  isFree: (x: number) => boolean
) => {
  for (const offset of offsets) {
    const x = from + (offset % span)
    if (isFree(x)) {
      grid[x] = [glyph, color, grid[x]?.[1] ?? 0]
    }
  }
}

export const sceneGridOf = (
  scene: SceneDefinition,
  phase: FlowPhase | undefined,
  columns: number,
  tick: number,
  caption = '',
  since = -Infinity,
  reaction?: Reaction,
  isResting = false,
  action?: Action,
  advisor?: AdvisorPose
): number[][] => {
  const reacting = isReacting(reaction)
  const resting = isResting && !reacting
  const hop = reacting && reaction.age % 6 < 3 ? 1 : 0
  const pet = scene.cast?.pet
  // A scene with a pet hearts the pet; without one, its hero is Clawd and gets petted.
  const isPetted = reacting && reaction.kind === 'pet' && pet !== undefined
  const look = scene.looks[phase ?? 'working']
  const costume = scene.costumes[phase ?? 'working']
  const grid: number[][] = []
  // Why a stage: Jev's advisor keeps the right edge, so the hero and its pet walk short of it.
  const stage = advisorStageOf(columns, advisor)
  const walk = resting ? restColumnOf(stage) : walkColumn(stage, tick)
  const shown = resting ? undefined : action
  const petAt = pet === undefined ? 0 : petColumnOf(pet, stage, tick, resting)
  const petFrame = pet === undefined ? undefined : petFrameOf(pet, tick, resting, isPetted)
  const at = (x: number, y: number) =>
    actionPixel(shown, x - walk - SPRITE_WIDTH, y, tick) ??
    clawdPixel(costume, x, y + (isPetted ? 0 : hop), tick, walk, resting) ??
    (pet === undefined || petFrame === undefined
      ? undefined
      : castPixel(petFrame, pet.colors, x, y, petAt, isPetted ? hop : 0)) ??
    (advisor === undefined ? undefined : advisorPixel(advisor, columns, x, y, tick)) ??
    landscapePixel(look, columns, x, y, tick, resting)
  for (let row = 0; row < SCENE_ROWS; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      grid.push([UPPER_HALF, at(x, row * 2), at(x, row * 2 + 1)])
    }
  }
  // Who speaks: the pet while it is petted, else the hero.
  const speaker = isPetted
    ? { at: petAt, width: castWidthOf(petFrame) }
    : { at: walk, width: SPRITE_WIDTH }
  const said = reacting ? reactionSaysOf(reaction.kind) : resting ? snoreOf(tick) : caption
  const typedSince = reacting ? tick - reaction.age : resting ? -Infinity : since
  const advisorText = advisorSaysOf(advisor, tick, columns)
  // The hero's bubble ends where the advisor's begins.
  const limit = advisorText === '' ? columns : columns - advisorText.length - 2
  const text = ` ${bubbleTextOf(said, tick, typedSince, Math.max(1, Math.min(columns - 8, limit - 4)))} `
  const width = text.length + 2
  const left = Math.max(0, Math.min(limit - width, speaker.at + speaker.width - 1))
  paintBubble(grid, left, text)
  if (advisorText !== '') {
    paintBubble(grid, limit, advisorText)
  }
  const puff = speaker.at + speaker.width
  if (puff < columns && puff < left + 1 && Math.floor(tick / 6) % 2 === 0) {
    grid[columns + puff] = [UPPER_HALF, BUBBLE, grid[columns + puff]?.[2] ?? 0]
  }
  // Hearts and stars land on neither bubble, nor past the scene's edge.
  const isFree = (x: number) => (x < left || x >= left + width) && x < limit
  if (reacting && reaction.kind === 'level') {
    sprinkle(
      grid,
      [0, 3, 6].map((o) => o + reaction.age),
      walk,
      10,
      0x2605,
      0xffd84a,
      isFree
    )
  }
  if (reacting && reaction.kind === 'pet') {
    sprinkle(
      grid,
      [1, 5].map((o) => o + reaction.age),
      speaker.at,
      Math.max(1, speaker.width - 1),
      0x2665,
      HEART,
      isFree
    )
  }
  if (shown === 'merge' && scene.finale !== undefined) {
    paintFinale(grid, columns, localizedNameOf(scene.finale))
  }
  return grid
}

// The advisor's words type in from the moment its gesture starts, cut to half the scene at most.
export const advisorSaysOf = (
  advisor: AdvisorPose | undefined,
  tick: number,
  columns: number
): string => {
  if (advisor === undefined || advisor.bubble === '') {
    return ''
  }
  const room = Math.max(1, Math.min(ADVISOR_BUBBLE_MAX, Math.floor(columns / 2) - 4))
  return ` ${bubbleTextOf(advisor.bubble, tick, tick - advisor.age, room)} `
}

// Bottom-right of the ground row, as PR #32 draws it, while a merge runs.
export const paintFinale = (
  grid: number[][],
  columns: number,
  finale: string,
  rows = SCENE_ROWS
): void => {
  const glyphs = Array.from(` ${finale} `)
  if (glyphs.length >= columns) {
    return
  }
  const from = (rows - 1) * columns + columns - glyphs.length - 1
  glyphs.forEach((glyph, index) => {
    grid[from + index] = glyphCell(glyph, FINALE_TEXT, FINALE_PANEL)
  })
}

export const sceneCellsOf = (
  ...args: Parameters<typeof sceneGridOf>
): { rows: number; cells: string } => ({ rows: SCENE_ROWS, cells: cellsOf(sceneGridOf(...args)) })
