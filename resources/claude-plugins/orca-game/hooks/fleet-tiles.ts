import {
  isBlink,
  isRestingOf,
  moodMarkOf,
  moodPixel,
  type MemberState,
  type Mood
} from './party-sprites'
import { cellsOf, glyphCell, hash, UPPER_HALF } from './pixel-canvas'
import { SPRITE_WIDTH } from './scene'
import type { Costume, SceneDefinition, ScenePhase } from './scenes/index'

export const TILE_COLUMNS = 22
export const TILE_ROWS = 4
// A card's round border and the text column's padding on each side.
const CARD_FRAME = 4
// Why 20: below it the head row cuts the ticket (`LU… idle`), so the tile goes first (ORCA-827).
const CARD_TEXT_MIN = 20

/** A card's text room, and whether the tile still fits beside it at `columns`. */
export const cardLayoutOf = (columns: number): { withTile: boolean; room: number } => {
  const withTile = columns - TILE_COLUMNS - CARD_FRAME >= CARD_TEXT_MIN
  return {
    withTile,
    room: Math.max(1, columns - CARD_FRAME - (withTile ? TILE_COLUMNS : 0))
  }
}

const TILE_PIXELS = TILE_ROWS * 2
const TILE_FLOOR = TILE_PIXELS - 1
const WALL = 0x1d212b
const WOOD = 0x5a3d26
const CONFETTI = [0xff5a5a, 0xffd84a, 0x56c8d8, 0x7fd36a, 0xc58af0] as const
const CHECK: readonly (readonly [number, number])[] = [
  [13, 4],
  [14, 5],
  [15, 6],
  [16, 5],
  [17, 4],
  [18, 3],
  [19, 2]
]

export type TileKind = ScenePhase | 'handed'

/** What a tile shows behind its figures: the wall, and the floor on its last pixel row. */
export const tileBackdropOf = (y: number): number => (y === TILE_FLOOR ? WOOD : WALL)

const box = (x: number, y: number, left: number, top: number, right: number, bottom: number) =>
  x >= left && x <= right && y >= top && y <= bottom

const screenPixel = (x: number, y: number, tick: number): number | undefined => {
  if (box(x, y, 12, 6, 18, 6)) {
    return 0x9aa3ab
  }
  const isFrame =
    box(x, y, 13, 2, 17, 2) ||
    box(x, y, 13, 5, 17, 5) ||
    box(x, y, 13, 2, 13, 5) ||
    box(x, y, 17, 2, 17, 5)
  if (isFrame) {
    return 0x4b5260
  }
  if (box(x, y, 14, 3, 16, 4)) {
    return hash(x + tick, y) % 3 === 0 ? 0x7fd36a : 0x1f3a2a
  }
  return undefined
}

const scrollPixel = (x: number, y: number, tick: number): number | undefined => {
  const quill = 12 + (Math.floor(tick / 2) % 9)
  if (box(x, y, 12, 5, 19, 6)) {
    return y === 5 && x < quill && x % 2 === 0 ? 0x3e2a78 : 0xf1e2b8
  }
  if (x === quill && (y === 3 || y === 4)) {
    return y === 3 ? 0xffffff : 0x3e2a78
  }
  return undefined
}

const anvilPixel = (x: number, y: number, tick: number): number | undefined => {
  const isStrike = Math.floor(tick / 3) % 2 === 0
  if (box(x, y, 13, 5, 18, 5) || box(x, y, 15, 6, 16, 6)) {
    return isStrike ? 0xd98a3d : 0x6b7280
  }
  if (isStrike && box(x, y, 12, 1, 19, 4) && hash(x + tick, y) % 5 === 0) {
    return y < 3 ? 0xffd84a : 0xff8a3d
  }
  return undefined
}

const bugPixel = (x: number, y: number, tick: number): number | undefined => {
  if (Math.floor(tick / 18) % 2 === 1) {
    return CHECK.some(([cx, cy]) => cx === x && cy === y) ? 0x7fd36a : undefined
  }
  const bugAt = 12 + (Math.floor(tick / 3) % 6)
  if (box(x, y, bugAt, 5, bugAt + 1, 6)) {
    return 0xd83a2e
  }
  return y === 4 && (x === bugAt - 1 || x === bugAt + 2) ? 0x1a1a1a : undefined
}

const letterPixel = (x: number, y: number, tick: number): number | undefined => {
  const at = 11 + (Math.floor(tick / 2) % 10)
  const top = 2 - (Math.floor(tick / 2) % 10 > 5 ? 1 : 0)
  if (!box(x, y, at, top, at + 3, top + 2)) {
    return undefined
  }
  return y - top === x - at || y - top === at + 3 - x ? 0xd4a017 : 0xffffff
}

const confettiPixel = (x: number, y: number, tick: number): number | undefined => {
  if (x < 11) {
    return undefined
  }
  const seed = hash(x, (y - Math.floor(tick / 2) + 64) % 8)
  return seed % 7 === 0 ? CONFETTI[seed % CONFETTI.length] : undefined
}

const PROPS: Readonly<
  Record<TileKind, (x: number, y: number, tick: number) => number | undefined>
> = {
  working: screenPixel,
  docs: scrollPixel,
  build: anvilPixel,
  verify: bugPixel,
  pr: letterPixel,
  handoff: confettiPixel,
  handed: confettiPixel
}

const tileClawd = (
  scene: SceneDefinition,
  kind: TileKind,
  state: MemberState,
  x: number,
  y: number,
  tick: number,
  mood: Mood
): number | undefined => {
  const costume = scene.costumes[kind === 'handed' ? 'handoff' : kind]
  const isResting = isRestingOf(state, mood)
  const isHopping =
    !isResting &&
    ((state === 'waiting' && isBlink(tick)) || (kind === 'build' && Math.floor(tick / 3) % 2 === 0))
  const top = 1 - (isHopping ? 1 : 0) + (isResting ? 1 : 0)
  const column = x - 1
  const last = top + costume.rows.length
  if (column < 0 || column >= SPRITE_WIDTH || y < top || y > last || (isResting && y === last)) {
    return undefined
  }
  const legs = state === 'working' ? Math.floor(tick / 2) % 2 : 0
  const row = y === last ? costume.legs[legs] : costume.rows[y - top]
  return moodPixel(mood, costume.colors[row?.[column] ?? '.'], tick)
}

// The scene's foe faces the member, mirrored and swaying, where its prop would be.
const foeProp =
  (foe: Costume) =>
  (x: number, y: number, tick: number): number | undefined => {
    const column = x - (11 + (Math.floor(tick / 3) % 2))
    const last = foe.rows.length
    if (column < 0 || column >= SPRITE_WIDTH || y < 0 || y > last) {
      return undefined
    }
    const row = y === last ? foe.legs[Math.floor(tick / 2) % 2] : foe.rows[y]
    return foe.colors[row?.[SPRITE_WIDTH - 1 - column] ?? '.']
  }

export const tileGridOf = (
  scene: SceneDefinition,
  kind: TileKind,
  state: MemberState,
  tick: number,
  mood: Mood = 'none'
): number[][] => {
  const moving = state === 'idle' && mood === 'none' ? 0 : tick
  const prop =
    mood === 'hurt' && scene.foe !== undefined
      ? foeProp(scene.foe)
      : PROPS[mood === 'cheer' ? 'handed' : kind]
  const grid: number[][] = []
  for (let row = 0; row < TILE_ROWS; row += 1) {
    for (let x = 0; x < TILE_COLUMNS; x += 1) {
      const pixel = (y: number): number =>
        tileClawd(scene, kind, state, x, y, moving, mood) ??
        (y === TILE_FLOOR ? WOOD : (prop(x, y, moving) ?? tileBackdropOf(y)))
      grid.push([UPPER_HALF, pixel(row * 2), pixel(row * 2 + 1)])
    }
  }
  const mark = moodMarkOf(state, mood, tick)
  if (mark !== undefined) {
    grid[TILE_COLUMNS - 1] = glyphCell(mark.glyph, mark.color, WALL)
  }
  return grid
}

export const tileCellsOf = (...args: Parameters<typeof tileGridOf>): string =>
  cellsOf(tileGridOf(...args))
