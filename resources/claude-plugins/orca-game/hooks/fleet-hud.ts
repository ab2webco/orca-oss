import { actionPixel } from './action-props'
import {
  IDLE,
  isBlink,
  isRestingOf,
  moodMarkOf,
  moodPixel,
  snoreGlyph,
  WAITING,
  WORKING,
  type MemberState,
  type Mood
} from './party-sprites'
import { cellsOf, glyphCell, hash, mix, UPPER_HALF } from './pixel-canvas'
import type { Action } from './quest-policy'
import { SPRITE_WIDTH } from './scene'
import type { SceneDefinition, ScenePhase } from './scenes/index'

export const HUD_ROWS = 5
export const HUD_KEY = 'orca-game-hud'

const HUD_PIXELS = HUD_ROWS * 2
const HUD_TOP = 0x1a1f33
const HUD_BOTTOM = 0x2b3150
const HUD_FRAME = 0xc9a24a
const HUD_TEXT = 0xf1e2b8
const HUD_DIM = 0x8a90a8
const PARTY_AT = 14
const SLOT = 22
const XP_CELLS = 5

export type HudMember = {
  name: string
  phase: ScenePhase
  state: MemberState
  mood?: Mood
  action?: Action
  says: string
}

export type Level = { level: number; into: number; need: number }

export type HudExtras = { isHeroWorking?: boolean; level?: Level; isDemo?: boolean }

const hudSky = (x: number, y: number, tick: number): number => {
  if (y === 0 || y === HUD_PIXELS - 1) {
    return HUD_FRAME
  }
  const isStar =
    (y === 1 || y >= 7) && hash(x, y) % 23 === 0 && (hash(x, y) + Math.floor(tick / 5)) % 5 !== 0
  return isStar ? 0xf5f3c8 : mix(HUD_TOP, HUD_BOTTOM, y / (HUD_PIXELS - 1))
}

type Sprite = { phase: ScenePhase; state: MemberState; mood?: Mood; at: number }

const hudSprite = (
  scene: SceneDefinition,
  sprite: Sprite,
  x: number,
  y: number,
  tick: number
): number | undefined => {
  const costume = scene.costumes[sprite.phase]
  const isResting = isRestingOf(sprite.state, sprite.mood)
  const top = 2 - (sprite.state === 'waiting' && isBlink(tick) ? 1 : 0) + (isResting ? 1 : 0)
  const column = x - sprite.at
  const last = top + costume.rows.length
  const isOutside = column < 0 || column >= SPRITE_WIDTH || y < top || y > last
  if (isOutside || y >= HUD_PIXELS - 1 || (isResting && y === last)) {
    return undefined
  }
  const legs = sprite.state === 'working' ? Math.floor(tick / 2) % 2 : 0
  const row = y === last ? costume.legs[legs] : costume.rows[y - top]
  return moodPixel(sprite.mood, costume.colors[row?.[column] ?? '.'], tick)
}

const hudWrite = (
  grid: number[][],
  columns: number,
  row: number,
  x: number,
  text: string,
  color: number,
  room: number
) => {
  const fitted = text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text
  Array.from(fitted).forEach((glyph, offset) => {
    const at = row * columns + x + offset
    const cell = grid[at]
    if (x + offset < columns - 1 && cell !== undefined) {
      grid[at] = glyphCell(glyph, color, cell[2] ?? 0)
    }
  })
}

export const xpTextOf = (level: Level): string => {
  const filled = Math.min(XP_CELLS, Math.floor((level.into / Math.max(1, level.need)) * XP_CELLS))
  const bar = `${'■'.repeat(filled)}${'□'.repeat(XP_CELLS - filled)}`
  return `Lv ${level.level} ${bar} ${level.into}/${level.need} XP`
}

const heroStateOf = (members: readonly HudMember[], extras: HudExtras): MemberState => {
  if (members.some((one) => one.state === 'waiting')) {
    return 'waiting'
  }
  const isWorking = extras.isHeroWorking === true || members.some((one) => one.state === 'working')
  return isWorking ? 'working' : 'idle'
}

const memberLine = (one: HudMember): string => {
  if (one.state === 'waiting') {
    return 'needs you!'
  }
  return one.mood === 'hurt' ? 'CI is red' : one.says
}

export const hudGridOf = (
  scene: SceneDefinition,
  members: readonly HudMember[],
  columns: number,
  tick: number,
  extras: HudExtras = {}
): number[][] => {
  const shown = members.slice(0, Math.max(0, Math.floor((columns - PARTY_AT - 1) / SLOT)))
  const heroState = heroStateOf(members, extras)
  const heroAt = heroState === 'idle' ? 2 : 2 + (Math.floor(tick / 8) % 2)
  const hero: Sprite = { phase: 'working', state: heroState, at: heroAt }
  const pixel = (x: number, y: number): number => {
    if (x === 0 || x === columns - 1) {
      return HUD_FRAME
    }
    const heroPixel = hudSprite(scene, hero, x, y, tick)
    if (heroPixel !== undefined) {
      return heroPixel
    }
    const slot = Math.floor((x - PARTY_AT) / SLOT)
    const one = x >= PARTY_AT ? shown[slot] : undefined
    if (one === undefined) {
      return hudSky(x, y, tick)
    }
    const at = PARTY_AT + slot * SLOT
    const member = hudSprite(scene, { ...one, at }, x, y, tick)
    const hasProp = !isRestingOf(one.state, one.mood) && y >= 6
    const prop = hasProp ? actionPixel(one.action, x - (at + SPRITE_WIDTH + 1), y, tick) : undefined
    return member ?? prop ?? hudSky(x, y, tick)
  }
  const grid: number[][] = []
  for (let row = 0; row < HUD_ROWS; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      grid.push([UPPER_HALF, pixel(x, row * 2), pixel(x, row * 2 + 1)])
    }
  }
  // Flat cells on the text rows become spaces so names read over the sky.
  for (let row = 1; row <= 2; row += 1) {
    for (let x = PARTY_AT; x < columns; x += 1) {
      const cell = grid[row * columns + x]
      if (cell !== undefined && cell[0] === UPPER_HALF && cell[1] === cell[2]) {
        grid[row * columns + x] = [0x20, HUD_TEXT, cell[1] ?? 0]
      }
    }
  }
  const room = columns - PARTY_AT - 2
  if (shown.length === 0) {
    hudWrite(grid, columns, 1, PARTY_AT, 'No party yet.', HUD_TEXT, room)
    hudWrite(grid, columns, 2, PARTY_AT, 'Teammates join when the lead spawns them.', HUD_DIM, room)
  }
  shown.forEach((one, slot) => {
    const left = PARTY_AT + slot * SLOT + SPRITE_WIDTH + 1
    const color = one.state === 'waiting' ? WAITING : one.state === 'idle' ? IDLE : WORKING
    hudWrite(grid, columns, 1, left, one.name, color, SLOT - SPRITE_WIDTH - 2)
    hudWrite(grid, columns, 2, left, memberLine(one), HUD_DIM, SLOT - SPRITE_WIDTH - 2)
    const mark = moodMarkOf(one.state, one.mood, tick)
    if (mark !== undefined) {
      hudWrite(grid, columns, 1, left - 1, mark.glyph, mark.color, 1)
    }
  })
  if (heroState === 'waiting' && isBlink(tick)) {
    hudWrite(grid, columns, 1, heroAt + SPRITE_WIDTH, '!', WAITING, 1)
  }
  if (heroState === 'idle') {
    hudWrite(grid, columns, 1, heroAt + SPRITE_WIDTH, snoreGlyph(tick), IDLE, 1)
  }
  if (extras.level !== undefined && columns > PARTY_AT + 4) {
    hudWrite(grid, columns, 0, PARTY_AT, ` ${xpTextOf(extras.level)} `, HUD_FRAME, room)
  }
  if (extras.isDemo === true && columns > 10) {
    hudWrite(grid, columns, 0, 2, ' DEMO ', WAITING, 6)
  }
  return grid
}

export const hudCellsOf = (...args: Parameters<typeof hudGridOf>): string =>
  cellsOf(hudGridOf(...args))
