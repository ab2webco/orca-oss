import { rasterGlyphsOf } from './game-strings'
import { floatingRowOf } from './hd-fx'
import type { PlacedMember } from './hd-party'
import type { ThoughtBox } from './hd-thought'
import type { Reaction } from './scene'

// What hd writes over its pixels: floating team reactions, sparkles, the waiting `!`, labels, and the shake.

/** A team event the hd scene acts out: a reward, a teammate waiting, a merge or CI turning red. */
export type TeamEvent = { kind: 'xp' | 'needs' | 'merged' | 'fail'; text: string; age: number }

export const TEAM_EVENT_TICKS = 24
const QUAKE_TICKS = 8
const HEART = 0xff5a8a
const STAR_GOLD = 0xffd84a
const WAITING = 0xff4a4a
const WAITING_DIM = 0xffb0a8
const PLATE = 0x1a1a24

const FLOAT_COLOR: Readonly<Record<TeamEvent['kind'], number>> = {
  xp: 0xffd84a,
  needs: WAITING,
  merged: 0xffffff,
  fail: WAITING
}

export const isTeamEventShown = (event: TeamEvent | undefined): event is TeamEvent =>
  event !== undefined && event.age >= 0 && event.age < TEAM_EVENT_TICKS

/** How far a red CI shakes the scene this tick: a column either way, for its first ticks. */
export const quakeOf = (event: TeamEvent | undefined): number =>
  event?.kind === 'fail' && event.age >= 0 && event.age < QUAKE_TICKS
    ? event.age % 2 === 0
      ? 1
      : -1
    : 0

export const shakeGrid = (grid: number[][], columns: number, dx: number): number[][] => {
  if (dx === 0) {
    return grid
  }
  const out: number[][] = []
  for (let row = 0; row < grid.length / columns; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      out.push(grid[row * columns + Math.min(columns - 1, Math.max(0, x - dx))] ?? [])
    }
  }
  return out
}

/** The clouds on screen: the hero's (or its pet's) first, then the advisor's. */
export type Clouds = readonly (ThoughtBox | undefined)[]

const isNearBox = (boxes: Clouds, row: number, from: number, to: number): boolean =>
  boxes.some(
    (box) =>
      box !== undefined &&
      row >= box.row - 1 &&
      row <= box.row + box.lines &&
      to > box.left - 3 &&
      from <= box.right + 3
  )

/** The event's text rising from the hero's head; skipped when wider than the scene or over a cloud. */
export const floatInto = (
  grid: number[][],
  columns: number,
  event: TeamEvent,
  startRow: number,
  centre: number,
  boxes: Clouds
): void => {
  const box = boxes[0]
  const text = rasterGlyphsOf(` ${event.text} `)
  if (text.length > columns) {
    return
  }
  const row = floatingRowOf(startRow, event.age)
  const centred = Math.max(0, Math.min(columns - text.length, centre - Math.floor(text.length / 2)))
  // Why the sides: the cloud sits by the hero's head, so a text that would cover it rises beside it.
  const start = [centred, (box?.left ?? 0) - 4 - text.length, (box?.right ?? 0) + 5].find(
    (one) =>
      one >= 0 && one + text.length <= columns && !isNearBox(boxes, row, one, one + text.length)
  )
  if (start === undefined) {
    return
  }
  text.forEach((glyph, k) => {
    const at = row * columns + start + k
    grid[at] = [glyph.codePointAt(0) ?? 0x20, FLOAT_COLOR[event.kind], grid[at]?.[2] ?? 0]
  })
}

/** Stars around a level-up and hearts around a pet, on the cloud's row and never on it. */
export const sparklesInto = (
  grid: number[][],
  columns: number,
  row: number,
  from: number,
  span: number,
  reaction: Reaction | undefined,
  boxes: Clouds
): void => {
  if (reaction === undefined || (reaction.kind !== 'level' && reaction.kind !== 'pet')) {
    return
  }
  const offsets = reaction.kind === 'level' ? [0, 4, 8] : [2, 7]
  const [glyph, color]: readonly [number, number] =
    reaction.kind === 'level' ? [0x2605, STAR_GOLD] : [0x2665, HEART]
  for (const offset of offsets) {
    const x: number = from + ((offset + reaction.age) % Math.max(1, span))
    const at = row * columns + x
    if (x >= 0 && x < columns && !isNearBox(boxes, row, x, x + 1) && grid[at] !== undefined) {
      grid[at] = [glyph, color, grid[at]?.[1] ?? 0]
    }
  }
}

/** A pulsing `!` over each teammate waiting on the person, clear of the cloud. */
export const waitingMarksInto = (
  grid: number[][],
  columns: number,
  members: readonly PlacedMember[],
  spriteWidth: number,
  tick: number,
  boxes: Clouds
): void => {
  for (const one of members) {
    if (one.member.state !== 'waiting') {
      continue
    }
    const row = Math.max(0, Math.floor(one.top / 2) - 1)
    const x = one.left + Math.floor(spriteWidth / 2)
    const at = row * columns + x
    if (grid[at] !== undefined && !isNearBox(boxes, row, x - 2, x + 3)) {
      grid[at] = [0x21, Math.floor(tick / 4) % 2 === 0 ? WAITING : WAITING_DIM, grid[at]?.[2] ?? 0]
    }
  }
}

/** A label on a dark plate centred under `centre` on `row`. */
export const labelInto = (
  grid: number[][],
  columns: number,
  row: number,
  centre: number,
  text: string,
  color: number
): void => {
  const glyphs = rasterGlyphsOf(` ${text} `)
  if (glyphs.length > columns) {
    return
  }
  const from = Math.max(0, Math.min(columns - glyphs.length, centre - Math.ceil(glyphs.length / 2)))
  glyphs.forEach((glyph, offset) => {
    const at = row * columns + from + offset
    if (grid[at] !== undefined) {
      grid[at] = [glyph.codePointAt(0) ?? 0x20, color, PLATE]
    }
  })
}
