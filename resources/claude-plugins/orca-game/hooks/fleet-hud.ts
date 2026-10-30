import { actionPixel } from './action-props'
import { characterCostumeOf } from './character-look'
import { cellWidthOf, fitCells } from './cell-width'
import { gameStrings } from './game-strings'
import { crownAtOf, crownPixel } from './hd-party'
import { shortMemberNameOf } from './member-character'
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
import type { HudPalette, SceneDefinition, ScenePhase } from './scenes/index'

export const HUD_ROWS = 5
export const HUD_KEY = 'orca-game-hud'

const HUD_PIXELS = HUD_ROWS * 2
// Quest's night sky, for every scene that brings no hud palette of its own.
export const QUEST_HUD: HudPalette = {
  skyTop: 0x1a1f33,
  skyBottom: 0x2b3150,
  frame: 0xc9a24a,
  text: 0xf1e2b8,
  dim: 0x8a90a8,
  star: 0xf5f3c8
}
const PARTY_AT = 14
const SLOT = 22
const XP_CELLS = 5

/** Below this the frame has no room for one teammate, so the band draws `hudLineOf` instead. */
export const HUD_MIN_COLUMNS = PARTY_AT + SLOT + 1

export type HudMember = {
  name: string
  phase: ScenePhase
  state: MemberState
  mood?: Mood
  action?: Action
  says: string
}

export type Level = { level: number; into: number; need: number }

export type HudExtras = {
  isHeroWorking?: boolean
  level?: Level
  isDemo?: boolean
  /** This pane's lead title, as the band's `quest.lead`; the hero wears the crown only when set. */
  lead?: string
  /** Members left out of `members` (ghosts), which the `+N` counts too. */
  unseen?: number
}

const hudSky = (hud: HudPalette, x: number, y: number, tick: number): number => {
  if (y === 0 || y === HUD_PIXELS - 1) {
    return hud.frame
  }
  const isStar =
    (y === 1 || y >= 7) && hash(x, y) % 23 === 0 && (hash(x, y) + Math.floor(tick / 5)) % 5 !== 0
  return isStar ? hud.star : mix(hud.skyTop, hud.skyBottom, y / (HUD_PIXELS - 1))
}

type Sprite = { phase: ScenePhase; state: MemberState; mood?: Mood; at: number; name?: string }

const spriteTopOf = (sprite: Sprite, tick: number): number =>
  2 -
  (sprite.state === 'waiting' && isBlink(tick) ? 1 : 0) +
  (isRestingOf(sprite.state, sprite.mood) ? 1 : 0)

const hudSprite = (
  scene: SceneDefinition,
  sprite: Sprite,
  x: number,
  y: number,
  tick: number
): number | undefined => {
  // A member on red CI trades turns with the scene's foe.
  const isFoeTurn = sprite.mood === 'hurt' && Math.floor(tick / 6) % 2 === 1
  const costume =
    (isFoeTurn ? scene.foe : undefined) ?? characterCostumeOf(scene, sprite.name, sprite.phase)
  const isResting = isRestingOf(sprite.state, sprite.mood)
  const top = spriteTopOf(sprite, tick)
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
  const art = gameStrings().art
  return `${art.level} ${level.level} ${bar} ${level.into}/${level.need} ${art.xp}`
}

const heroStateOf = (members: readonly HudMember[], extras: HudExtras): MemberState => {
  if (members.some((one) => one.state === 'waiting')) {
    return 'waiting'
  }
  const isWorking = extras.isHeroWorking === true || members.some((one) => one.state === 'working')
  return isWorking ? 'working' : 'idle'
}

const memberLine = (one: HudMember): string => {
  const art = gameStrings().art
  if (one.state === 'waiting') {
    return art.needsYou
  }
  return one.mood === 'hurt' ? art.ciIsRed : one.says
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
  const hud = scene.hud ?? QUEST_HUD
  const placed =
    extras.lead === undefined
      ? undefined
      : crownAtOf(scene.costumes.working.rows, heroAt, spriteTopOf(hero, tick))
  // Why the clamp: row 0 is the frame, so a crown over a costume's top row sits on the head instead.
  const crown = placed === undefined ? undefined : { ...placed, top: Math.max(1, placed.top) }
  const pixel = (x: number, y: number): number => {
    if (x === 0 || x === columns - 1) {
      return hud.frame
    }
    const crowned = crown === undefined ? undefined : crownPixel(x, y, crown.left, crown.top)
    if (crowned !== undefined) {
      return crowned
    }
    const heroPixel = hudSprite(scene, hero, x, y, tick)
    if (heroPixel !== undefined) {
      return heroPixel
    }
    const slot = Math.floor((x - PARTY_AT) / SLOT)
    const one = x >= PARTY_AT ? shown[slot] : undefined
    if (one === undefined) {
      return hudSky(hud, x, y, tick)
    }
    const at = PARTY_AT + slot * SLOT
    const member = hudSprite(scene, { ...one, at }, x, y, tick)
    const hasProp = !isRestingOf(one.state, one.mood) && y >= 6
    const prop = hasProp ? actionPixel(one.action, x - (at + SPRITE_WIDTH + 1), y, tick) : undefined
    return member ?? prop ?? hudSky(hud, x, y, tick)
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
        grid[row * columns + x] = [0x20, hud.text, cell[1] ?? 0]
      }
    }
  }
  const room = columns - PARTY_AT - 2
  if (members.length === 0) {
    const art = gameStrings().art
    hudWrite(grid, columns, 1, PARTY_AT, art.noParty, hud.text, room)
    hudWrite(grid, columns, 2, PARTY_AT, art.teammatesJoin, hud.dim, room)
  }
  shown.forEach((one, slot) => {
    const left = PARTY_AT + slot * SLOT + SPRITE_WIDTH + 1
    const color = one.state === 'waiting' ? WAITING : one.state === 'idle' ? IDLE : WORKING
    hudWrite(grid, columns, 1, left, shortMemberNameOf(one.name), color, SLOT - SPRITE_WIDTH - 2)
    hudWrite(grid, columns, 2, left, memberLine(one), hud.dim, SLOT - SPRITE_WIDTH - 2)
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
  const hidden = members.length - shown.length + (extras.unseen ?? 0)
  const plus = hidden > 0 ? ` +${hidden} ` : ''
  const plusAt = columns - 2 - plus.length
  // Why the +N first: it says who the band could not draw, and the XP text shortens instead.
  const xpRoom = Math.min(room, plusAt - PARTY_AT - (plus === '' ? 0 : 1))
  if (extras.level !== undefined && xpRoom >= 4) {
    hudWrite(grid, columns, 0, PARTY_AT, ` ${xpTextOf(extras.level)} `, hud.frame, xpRoom)
  }
  if (extras.isDemo === true && columns > 10) {
    hudWrite(grid, columns, 0, 2, ' DEMO ', WAITING, 6)
  }
  if (plus !== '' && plusAt > PARTY_AT) {
    hudWrite(grid, columns, 0, plusAt, plus, hud.text, plus.length)
  }
  return grid
}

const markOf = (one: HudMember): string => {
  if (one.state === 'waiting') {
    return '!'
  }
  if (one.mood === 'hurt') {
    return '×'
  }
  return one.state === 'working' ? '•' : 'z'
}

/** The HUD as one line of text, for a band too narrow for its frame. */
export const hudLineOf = (
  members: readonly HudMember[],
  columns: number,
  extras: HudExtras = {}
): string => {
  const art = gameStrings().art
  const unseen = extras.unseen ?? 0
  const head = [
    ...(extras.isDemo === true ? ['DEMO'] : []),
    ...(extras.level === undefined ? [] : [`${art.level} ${extras.level.level}`])
  ]
  const names = members.map((one) => `${markOf(one)} ${shortMemberNameOf(one.name)}`)
  const lineOf = (shown: number): string => {
    const hidden = members.length - shown + unseen
    const party = members.length === 0 ? art.noParty : names.slice(0, shown).join('  ')
    return [...head, [party, hidden > 0 ? `+${hidden}` : ''].filter(Boolean).join('  ')].join(' · ')
  }
  // Why drop names from the end: the `+N` must stay readable, and the first names are the busiest.
  for (let shown = members.length; shown > 0; shown -= 1) {
    if (cellWidthOf(lineOf(shown)) <= columns) {
      return lineOf(shown)
    }
  }
  return fitCells(lineOf(Math.min(1, members.length)), columns)
}

export const hudCellsOf = (...args: Parameters<typeof hudGridOf>): string =>
  cellsOf(hudGridOf(...args))
