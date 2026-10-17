import { costumeSpriteOf, type HdSprite } from './hd-sprite'
import { hash, mix } from './pixel-canvas'
import type { MemberState } from './party-sprites'
import type { SceneDefinition, ScenePhase } from './scenes/index'

// The hd party: teammates following the hero (or sitting by its fire), marching in and out, and the crown.

export const MARCH_TICKS = 24
export const MAX_SHOWN = 4

export type March = { kind: 'in' | 'out'; at: number }

/** A teammate as the hd scene draws it. */
export type HdMember = { key: string; phase: ScenePhase; state: MemberState }

export const STATE_RING: Readonly<Record<MemberState, number>> = {
  working: 0x4fc3f7,
  idle: 0x8a90a8,
  waiting: 0xff4a4a
}

const isMarching = (march: March | undefined, tick: number): boolean =>
  march !== undefined && tick - march.at < MARCH_TICKS

/** Who walks in (new keys) and out (gone keys) from this refresh, keeping marches still under way. */
export const marchesOf = (
  before: readonly string[],
  after: readonly string[],
  marches: ReadonlyMap<string, March>,
  tick: number
): Map<string, March> => {
  const next = new Map([...marches].filter(([, march]) => isMarching(march, tick)))
  for (const key of after) {
    if (!before.includes(key)) {
      next.set(key, { kind: 'in', at: tick })
    } else if (next.get(key)?.kind === 'out') {
      next.delete(key)
    }
  }
  for (const key of before) {
    if (!after.includes(key)) {
      next.set(key, { kind: 'out', at: tick })
    }
  }
  return next
}

/** How far right of its slot a marcher is: all the way at the start of a march in, none at its end. */
export const marchShiftOf = (march: March | undefined, tick: number, distance: number): number => {
  if (march === undefined || !isMarching(march, tick)) {
    return march?.kind === 'out' ? distance : 0
  }
  const progress = Math.max(0, tick - march.at) / MARCH_TICKS
  return Math.round((march.kind === 'in' ? 1 - progress : progress) * distance)
}

export type PlacedMember = {
  member: HdMember
  left: number
  top: number
  sprite: HdSprite
}

/** Each shown teammate's sprite and where it stands this tick. */
export const placedPartyOf = (args: {
  scene: SceneDefinition
  party: readonly HdMember[]
  leavers: readonly HdMember[]
  marches: ReadonlyMap<string, March>
  columns: number
  ground: number
  tick: number
  walk: number
  heading: number
  isResting: boolean
  fireRight: number
  spriteWidth: number
}): PlacedMember[] => {
  const { columns, ground, tick, spriteWidth } = args
  return [...args.party.slice(0, MAX_SHOWN), ...args.leavers]
    .slice(0, MAX_SHOWN + 2)
    .map((member, i) => {
      const home = args.isResting
        ? args.fireRight + 1 + i * (spriteWidth - 1)
        : args.walk - args.heading * (i + 1) * (spriteWidth - 1)
      const left = home + marchShiftOf(args.marches.get(member.key), tick, columns - home)
      const isSitting = args.isResting || member.state === 'idle'
      const sprite = costumeSpriteOf(
        args.scene.costumes[member.phase],
        Math.floor((tick + i * 3) / 4),
        isSitting
      )
      const step = isSitting ? 0 : Math.floor((tick + i) / 2) % 2
      return { member, left, top: ground - sprite.rows.length + 1 - step, sprite }
    })
    .filter((one) => one.left >= 0 && one.left + spriteWidth <= columns)
}

const CROWN = ['G.GG.G', 'GGRRGG'] as const
const GOLD = 0xffd84a
const GOLD_DARK = 0xc9962a
const JEWEL = 0xd83a2e
export const CROWN_WIDTH = CROWN[0].length
export const LEAD_GOLD = GOLD

const spanOf = (row: string): number => row.replace(/[.#]/g, '').length

/** Where the crown sits: centred on the sprite's first row wide enough to hold it. */
export const crownAtOf = (
  rows: readonly string[],
  left: number,
  top: number
): { left: number; top: number } => {
  const wide = rows.findIndex((row) => spanOf(row) >= CROWN_WIDTH)
  const first = Math.max(0, wide !== -1 ? wide : rows.findIndex((row) => spanOf(row) > 0))
  const row = rows[first] ?? ''
  const from = row.search(/[^.#]/)
  const to = row.search(/[^.#][.#]*$/)
  const centre = from < 0 ? row.length / 2 : (from + to) / 2
  return {
    left: left + Math.round(centre - (CROWN_WIDTH - 1) / 2),
    top: top + first - CROWN.length
  }
}

export const crownPixel = (x: number, y: number, left: number, top: number): number | undefined => {
  const glyph = CROWN[y - top]?.[x - left]
  if (glyph === undefined || glyph === '.') {
    return undefined
  }
  if (glyph === 'R') {
    return JEWEL
  }
  return y - top === 1 && (x - left === 0 || x - left === CROWN_WIDTH - 1) ? GOLD_DARK : GOLD
}

export const FIRE_WIDTH = 6
const LOG = 0x5a3a22
const FLAMES = [0xfff1a0, 0xffd24a, 0xff9a2e, 0xe0521e] as const

/** The campfire the resting party sits by: logs and a flickering flame `height` pixels up. */
export const hdCampfirePixel = (dx: number, height: number, tick: number): number | undefined => {
  if (dx < 0 || dx >= FIRE_WIDTH || height < 0) {
    return undefined
  }
  if (height === 0) {
    return dx === 0 || dx === FIRE_WIDTH - 1 ? mix(LOG, 0x000000, 0.3) : LOG
  }
  const centre = (FIRE_WIDTH - 1) / 2
  const reach = 4 + (hash(dx, Math.floor(tick / 2)) % 2) - Math.abs(dx - centre) * 1.3
  if (height > reach) {
    return undefined
  }
  const heat =
    Math.abs(dx - centre) * 0.9 + (height >= reach - 0.5 ? 1 : 0) + (height === 1 ? 1 : 0)
  return FLAMES[Math.min(3, Math.floor(heat))]
}
