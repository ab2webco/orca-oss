import { actionPixel } from './action-props'
import { cellsOf, hash, mix, mod, UPPER_HALF } from './pixel-canvas'
import type { Action, FlowPhase } from './quest-policy'
import type { Costume, Look, SceneDefinition } from './scenes/index'

export const SCENE_ROWS = 5
export const SCENE_TICK_MS = 120
export const SCENE_KEY = 'orca-game-scene'
export const CLAWD_TOP = 2
export const SPRITE_WIDTH = 10
const MAX_COLUMNS = 512
const MARGIN = 2
const PIXEL_ROWS = SCENE_ROWS * 2
const STAR = 0xf5f3c8
const BUBBLE = 0xf4f4f0
const BUBBLE_TEXT = 0x23232b
const GROUND = PIXEL_ROWS - 1
const PEAK_EVERY = 23
const HEART = 0xff5a8a

const peakOf = (x: number): { top: number; height: number } => {
  let best = { top: GROUND, height: 0 }
  const index = Math.floor(x / PEAK_EVERY)
  for (let i = index - 1; i <= index + 1; i += 1) {
    const centre = i * PEAK_EVERY + (hash(i, 3) % 10)
    const height = 4 + (hash(i, 5) % 4)
    const top = Math.round(GROUND - 1 - Math.max(0, height - Math.abs(x - centre) * 0.7))
    if (top < best.top) {
      best = { top, height }
    }
  }
  return best
}

const hillTop = (x: number): number =>
  Math.max(
    6,
    Math.min(GROUND, Math.round(7.7 - 0.9 * Math.sin(x * 0.17 + 2) - 0.6 * Math.sin(x * 0.37)))
  )

export const sceneColumnsOf = (viewport: number | undefined): number =>
  Math.max(1, Math.min(MAX_COLUMNS, (viewport ?? 80) - MARGIN))

export const walkColumn = (width: number, tick: number): number => {
  const span = Math.max(1, width - 10)
  const step = Math.floor(tick / 2) % (span * 2)
  return step < span ? step : span * 2 - step
}

export const restColumnOf = (width: number): number => Math.max(0, Math.floor((width - 10) / 3))

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

const plantPixel = (look: Look, x: number, y: number, top: number): number | undefined => {
  const slot = mod(x, 13)
  if (look.plantKind === 'none' || hash(Math.floor(x / 13), 9) % 3 === 0) {
    return undefined
  }
  if (look.plantKind === 'tree') {
    if (y === top - 3 && slot === 6) {
      return look.plant
    }
    return (y === top - 2 || y === top - 1) && slot >= 5 && slot <= 7 ? look.plant : undefined
  }
  if (slot === 6 && y >= top - 3 && y < top) {
    return look.plant
  }
  return slot === 7 && y === top - 2 ? look.plant : undefined
}

const skyPixel = (look: Look, width: number, x: number, y: number, tick: number): number => {
  const dx = x - (width - 14)
  const dy = y - 2.5
  if (dx * dx + dy * dy * 1.4 <= 5) {
    return look.sun
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

export const pixelOf = (
  look: Look,
  costume: Costume,
  width: number,
  x: number,
  y: number,
  tick: number,
  lift = 0,
  isResting = false
): number => {
  const at = isResting ? restColumnOf(width) : walkColumn(width, tick)
  const clawd = clawdPixel(costume, x, y + lift, tick, at, isResting)
  if (clawd !== undefined) {
    return clawd
  }
  const scroll = isResting ? 0 : tick
  if (y === GROUND) {
    return hash(x + scroll, 7) % 9 === 0 ? mix(look.ground, 0x000000, 0.25) : look.ground
  }
  const nx = x + Math.floor(scroll / 2)
  const hill = hillTop(nx)
  if (y >= hill) {
    return mix(look.near, 0x000000, (y - hill) * 0.08)
  }
  const plant = plantPixel(look, nx, y, hill)
  if (plant !== undefined) {
    return plant
  }
  const peak = peakOf(x + Math.floor(scroll / 6))
  if (y >= peak.top) {
    return y <= peak.top + 1 && peak.top <= 3
      ? look.snow
      : mix(look.far, look.near, (y - peak.top) * 0.06)
  }
  return skyPixel(look, width, x, y, tick)
}

const DOTS = ['.  ', '.. ', '...'] as const

export const REACTION_TICKS = 24

export type Reaction = { kind: 'pet' | 'hello' | 'level'; age: number }

const REACTION_SAYS = { pet: '♥ thanks!', hello: 'on it!', level: '★ level up!' } as const

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
  const said = caption === '' ? `thinking${DOTS[Math.floor(tick / 4) % DOTS.length]}` : caption
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
  bubble: { left: number; width: number }
) => {
  for (const offset of offsets) {
    const x = from + (offset % span)
    if (x < bubble.left || x >= bubble.left + bubble.width) {
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
  action?: Action
): number[][] => {
  const reacting = isReacting(reaction)
  const resting = isResting && !reacting
  const lift = reacting && reaction.age % 6 < 3 ? 1 : 0
  const look = scene.looks[phase ?? 'working']
  const costume = scene.costumes[phase ?? 'working']
  const grid: number[][] = []
  const walk = resting ? restColumnOf(columns) : walkColumn(columns, tick)
  const shown = resting ? undefined : action
  const at = (x: number, y: number) =>
    actionPixel(shown, x - walk - SPRITE_WIDTH, y, tick) ??
    pixelOf(look, costume, columns, x, y, tick, lift, resting)
  for (let row = 0; row < SCENE_ROWS; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      grid.push([UPPER_HALF, at(x, row * 2), at(x, row * 2 + 1)])
    }
  }
  const said = reacting ? REACTION_SAYS[reaction.kind] : resting ? snoreOf(tick) : caption
  const typedSince = reacting ? tick - reaction.age : resting ? -Infinity : since
  const text = ` ${bubbleTextOf(said, tick, typedSince, Math.max(1, columns - 8))} `
  const width = text.length + 2
  const left = Math.max(0, Math.min(columns - width, walk + 9))
  const skyAt = (x: number) => grid[x]?.[1] ?? 0
  grid[left] = [0x2590, BUBBLE, skyAt(left)]
  Array.from(text).forEach((glyph, index) => {
    grid[left + 1 + index] = [glyph.codePointAt(0) ?? 0x20, BUBBLE_TEXT, BUBBLE]
  })
  grid[left + width - 1] = [0x258c, BUBBLE, skyAt(left + width - 1)]
  const puff = walk + SPRITE_WIDTH
  if (puff < columns && puff < left + 1 && Math.floor(tick / 6) % 2 === 0) {
    grid[columns + puff] = [UPPER_HALF, BUBBLE, grid[columns + puff]?.[2] ?? 0]
  }
  const bubble = { left, width }
  if (reacting && reaction.kind === 'level') {
    sprinkle(
      grid,
      [0, 3, 6].map((o) => o + reaction.age),
      walk,
      10,
      0x2605,
      0xffd84a,
      bubble
    )
  }
  if (reacting && reaction.kind === 'pet') {
    sprinkle(
      grid,
      [1, 5].map((o) => o + reaction.age),
      walk,
      9,
      0x2665,
      HEART,
      bubble
    )
  }
  return grid
}

export const sceneCellsOf = (
  ...args: Parameters<typeof sceneGridOf>
): { rows: number; cells: string } => ({ rows: SCENE_ROWS, cells: cellsOf(sceneGridOf(...args)) })
