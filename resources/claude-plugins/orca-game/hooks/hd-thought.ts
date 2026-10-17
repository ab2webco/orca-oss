import { gameStrings, rasterGlyphsOf } from './game-strings'
import { UPPER_HALF } from './pixel-canvas'

// hd's thought cloud: puffs along the top, lumps underneath, a 1-px outline, a highlight and a shadow,
// and a trail of two bubbles stepping down toward the hero's head, bobbing as it thinks.

export type ThoughtMood =
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'merged'
  | 'red'
  | 'idle'
  | 'reacting'

export const CLOUD = 0xf4f4f0
const CLOUD_LIGHT = 0xffffff
const CLOUD_SHADE = 0xc9ccd6
const OUTLINE = 0x7d879c
const RAIN_OUTLINE = 0x5d6474
const RAIN_CLOUD = 0xb9bdc8
const RAIN = 0x6aa0ff
export const CLOUD_TEXT = 0x23232b
const ALERT = 0xd83a2e
const ALERT_DIM = 0xf2a49c
const SPARKLE = 0xffd84a
const MAX_LINE = 36
const RED_SHAKE_TICKS = 12
const DOTS = ['.  ', '.. ', '...'] as const

export type ThoughtAt = {
  columns: number
  rows: number
  tick: number
  /** Where the cloud wants its left edge. */
  left: number
  /** The last column it may use, so it ends where another bubble begins. */
  limit: number
  row: number
  headRight: number
  headTop: number
  floor: number
}

export type ThoughtBox = { left: number; right: number; row: number; lines: number }

export const thoughtMoodOf = (args: {
  caption: string
  isResting: boolean
  isReacting: boolean
  isWaiting: boolean
  isRed: boolean
  isMerging: boolean
}): ThoughtMood => {
  if (args.isReacting) {
    return 'reacting'
  }
  if (args.isResting) {
    return 'idle'
  }
  if (args.isRed) {
    return 'red'
  }
  if (args.isMerging) {
    return 'merged'
  }
  if (args.isWaiting) {
    return 'waiting'
  }
  return args.caption === '' ? 'thinking' : 'working'
}

/** One line, or two split at a word, each at most `room` glyphs, ending in … when cut. */
export const thoughtLinesOf = (text: string, room: number): string[] => {
  const width = Math.max(4, room)
  const glyphs = [...text]
  if (glyphs.length <= width) {
    return [text]
  }
  const words = text.split(' ')
  let first = ''
  let rest = 0
  for (; rest < words.length; rest += 1) {
    const next = first === '' ? (words[rest] ?? '') : `${first} ${words[rest]}`
    if ([...next].length > width) {
      break
    }
    first = next
  }
  if (first === '') {
    return [`${glyphs.slice(0, width - 1).join('')}…`]
  }
  const second = [...words.slice(rest).join(' ')]
  return [
    first,
    second.length <= width
      ? second.join('')
      : `${second
          .slice(0, width - 1)
          .join('')
          .trimEnd()}…`
  ]
}

const textOf = (said: string, mood: ThoughtMood, tick: number) => {
  const dots = DOTS[Math.floor(tick / 4) % DOTS.length] ?? ''
  const base = mood === 'thinking' ? `${gameStrings().art.thinking}${dots}` : said
  const prefix = mood === 'waiting' ? '! ' : ''
  const suffix = mood === 'working' ? ` ${dots}` : ''
  return {
    text: `${prefix}${base}${suffix}`,
    from: prefix.length,
    to: prefix.length + [...base].length
  }
}

/** The trail's bubbles under the cloud, as [x, y, size] in pixels; it bobs a pixel every 8 ticks. */
export const trailOf = (
  left: number,
  bottom: number,
  tick: number
): readonly (readonly [number, number, number])[] => {
  const bob = Math.floor(tick / 8) % 2
  return [
    [left + 2, bottom + 3 + bob, 2],
    [left, bottom + 6 + bob, 1]
  ]
}

const setPixel = (grid: number[][], at: ThoughtAt, x: number, y: number, color: number): void => {
  if (x < 0 || x >= at.columns || y < 0 || y >= at.rows * 2) {
    return
  }
  const cell = grid[Math.floor(y / 2) * at.columns + x]
  if (cell !== undefined && cell[0] === UPPER_HALF) {
    cell[y % 2 === 0 ? 1 : 2] = color
  }
}

/** Draws the cloud and returns its box; undefined when the scene is too narrow to hold it. */
export const drawThought = (
  grid: number[][],
  said: string,
  mood: ThoughtMood,
  since: number,
  at: ThoughtAt
): ThoughtBox | undefined => {
  const { columns, rows, tick } = at
  const thought = textOf(rasterGlyphsOf(said).join(''), mood, tick)
  const room = Math.min(MAX_LINE, Math.max(4, Math.min(at.limit, columns) - 8))
  const isTyped = mood === 'working' || mood === 'waiting' || mood === 'merged' || mood === 'red'
  const shown = isTyped ? Math.max(1, (tick - since) * 3) : thought.to - thought.from
  let index = 0
  const lines = thoughtLinesOf(thought.text, room)
    .slice(0, Math.max(1, Math.min(2, rows - at.row - 2)))
    .map((line) => {
      const masked = [...line]
        .map((glyph, k) => {
          const i = index + k
          return i >= thought.from + shown && i < thought.to ? ' ' : glyph
        })
        .join('')
      index += [...line].length + 1
      return masked
    })
  const inner = Math.max(...lines.map((line) => [...line].length)) + 2
  const total = inner + 2
  const right = Math.min(at.limit, columns) - 2
  if (total + 4 > right + 2) {
    return undefined
  }
  const isShaking = mood === 'red' && tick - since >= 0 && tick - since < RED_SHAKE_TICKS
  const shake = isShaking ? (Math.floor(tick / 2) % 2 === 0 ? 1 : -1) : 0
  const left = Math.max(2, Math.min(right - total, at.left + shake))
  const boxRight = left + total - 1
  const cloud = mood === 'red' ? RAIN_CLOUD : CLOUD
  const outline = mood === 'red' ? RAIN_OUTLINE : OUTLINE
  const alert = Math.floor(tick / 4) % 2 === 0 ? ALERT : ALERT_DIM
  lines.forEach((line, i) => {
    const row = at.row + i
    const padded = [...` ${line}`]
    while (padded.length < inner) {
      padded.push(' ')
    }
    padded.forEach((glyph, k) => {
      const color = mood === 'waiting' && k === 1 && i === 0 ? alert : CLOUD_TEXT
      grid[row * columns + left + 1 + k] = [glyph.codePointAt(0) ?? 0x20, color, cloud]
    })
  })
  const top = at.row * 2
  const bottom = (at.row + lines.length) * 2
  const shape = new Map<number, number>()
  const key = (x: number, y: number): number => y * 4096 + x + 1024
  const put = (x: number, y: number, color: number) => shape.set(key(x, y), color)
  for (let x = left; x <= boxRight; x += 1) {
    for (let y = top - 1; y <= bottom; y += 1) {
      const isCorner = (x === left || x === boxRight) && (y === top - 1 || y === bottom)
      if (!isCorner) {
        put(x, y, y === bottom ? CLOUD_SHADE : cloud)
      }
    }
  }
  for (let y = top; y < bottom; y += 1) {
    put(left - 1, y, cloud)
    put(boxRight + 1, y, cloud)
  }
  const lift = Math.max(1, Math.min(2, top - 2))
  const puffs = Math.max(1, Math.round((boxRight - left - 3) / (lift === 2 ? 5 : 4)))
  for (let k = 0; k < puffs; k += 1) {
    const cx =
      puffs === 1
        ? Math.round((left + boxRight) / 2)
        : Math.round(left + 2 + (k * (boxRight - left - 4)) / (puffs - 1))
    for (let dy = 1; dy <= lift; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const isInside = dx * dx + dy * dy <= (lift === 2 ? 6 : 2)
        if (isInside && cx + dx > left && cx + dx < boxRight) {
          put(cx + dx, top - 1 - dy, dy === lift ? CLOUD_LIGHT : cloud)
        }
      }
    }
  }
  for (let cx = left + 3; cx + 2 <= boxRight - 1; cx += 5) {
    for (let dx = 0; dx < 3; dx += 1) {
      put(cx + dx, bottom + 1, mood === 'red' ? cloud : CLOUD_SHADE)
    }
  }
  const isClear = (x: number, y: number) => !(y >= at.headTop && x <= at.headRight) && y < at.floor
  for (const [x, y, size] of trailOf(left, bottom, tick)) {
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        if (isClear(x + dx, y + dy)) {
          put(x + dx, y + dy, dx === 0 && dy === 0 ? CLOUD_LIGHT : cloud)
        }
      }
    }
  }
  const isText = (x: number, y: number) => x > left && x < boxRight && y >= top && y < bottom
  for (const packed of shape.keys()) {
    const y = Math.floor(packed / 4096)
    const x = packed - y * 4096 - 1024
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ] as const) {
      if (shape.has(key(nx, ny)) || isText(nx, ny) || (ny >= bottom + 2 && !isClear(nx, ny))) {
        continue
      }
      const touching = [
        [nx - 1, ny],
        [nx + 1, ny],
        [nx, ny - 1],
        [nx, ny + 1]
      ].filter(([ax = 0, ay = 0]) => shape.has(key(ax, ay))).length
      if (touching <= 2) {
        setPixel(grid, at, nx, ny, outline)
      }
    }
  }
  for (const [packed, color] of shape) {
    const y = Math.floor(packed / 4096)
    setPixel(grid, at, packed - y * 4096 - 1024, y, color)
  }
  if (mood === 'red') {
    for (let x = left + 2; x < boxRight - 1; x += 3) {
      const y = bottom + 2 + ((tick + x) % 3)
      if (isClear(x, y)) {
        setPixel(grid, at, x, y, RAIN)
      }
    }
  }
  if (mood === 'merged') {
    for (const x of [left - 3, boxRight + 3]) {
      const cell = grid[at.row * columns + x]
      if (x >= 0 && x < columns && cell !== undefined) {
        const star = (Math.floor(tick / 3) + x) % 2 === 0 ? 0x2a : 0x2b
        grid[at.row * columns + x] = [star, SPARKLE, cell[2] ?? 0]
      }
    }
  }
  return { left, right: boxRight, row: at.row, lines: lines.length }
}
