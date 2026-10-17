import { actionPixel } from './action-props'
import { gameStrings, localizedNameOf, rasterGlyphsOf } from './game-strings'
import { landAtNight, NOON, type Daylight } from './hd-daylight'
import {
  bloomInto,
  FLASH_COLOR,
  flashInto,
  flashOf,
  particleKindOf,
  particlesInto,
  vignetteInto
} from './hd-fx'
import {
  isTeamEventShown,
  floatInto,
  labelInto,
  quakeOf,
  shakeGrid,
  sparklesInto,
  waitingMarksInto,
  type TeamEvent
} from './hd-overlay'
import {
  crownAtOf,
  crownPixel,
  FIRE_WIDTH,
  hdCampfirePixel,
  LEAD_GOLD,
  placedPartyOf,
  STATE_RING,
  type HdMember,
  type March
} from './hd-party'
import { costumeSpriteOf, hdSpritePixel } from './hd-sprite'
import { drawThought, thoughtMoodOf } from './hd-thought'
import { mix, UPPER_HALF } from './pixel-canvas'
import type { Action, FlowPhase } from './quest-policy'
import { isReacting, paintFinale, reactionSaysOf, snoreOf, type Reaction } from './scene'
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
  /** The caption is a teammate waiting on the person. */
  isWaiting?: boolean
  action?: Action
  advisor?: AdvisorPose
  light?: Daylight
  party?: readonly HdMember[]
  leavers?: readonly HdMember[]
  marches?: ReadonlyMap<string, March>
  /** The lead's label; the hero wears the crown only when it is set. */
  lead?: string
  event?: TeamEvent
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

/** A four-frame walk: two leg poses, each with the body up and down; breathing at rest. */
export const hdHeroPoseOf = (tick: number, isResting: boolean): { frame: number; bob: number } => ({
  frame: Math.floor(tick / 4) % 2,
  bob: isResting ? (tick % 32 < 16 ? 0 : 1) : Math.floor(tick / 2) % 2
})

const SHADOW = 0.38
const MEMBER_SHADOW = 0.3
const FIRE_GLOW = 0xff9a2e

let buffer = new Uint32Array(0)

export const hdSceneGridOf = (input: HdSceneInput): number[][] => {
  const { scene, columns, rows, tick } = input
  const reaction = isReacting(input.reaction) ? input.reaction : undefined
  const event = isTeamEventShown(input.event) ? input.event : undefined
  const resting = input.isResting === true && reaction === undefined
  const look = scene.looks[input.phase ?? 'working']
  const light = look.isNight ? NOON : (input.light ?? NOON)
  const frame = hdFrameOf({ look, width: columns, rows, tick, scroll: resting ? 0 : tick, light })
  const { ground, pixels } = frame
  const pose = hdHeroPoseOf(tick, resting)
  const sprite = costumeSpriteOf(scene.costumes[input.phase ?? 'working'], pose.frame, resting)
  const walk = resting ? hdRestColumnOf(columns) : hdWalkColumn(columns, tick)
  const heading = resting || hdWalkColumn(columns, tick + 2) >= walk ? 1 : -1
  const lift = reaction !== undefined && reaction.age % 6 < 3 ? 2 : 0
  const top = ground - sprite.rows.length + 1 - lift - pose.bob
  const shown = resting ? undefined : input.action
  const fireLeft = walk + HD_SPRITE_WIDTH + 1
  const members = placedPartyOf({
    scene,
    party: input.party ?? [],
    leavers: input.leavers ?? [],
    marches: input.marches ?? new Map(),
    columns,
    ground,
    tick,
    walk,
    heading,
    isResting: resting,
    fireRight: fireLeft + FIRE_WIDTH,
    spriteWidth: HD_SPRITE_WIDTH
  })
  const crown = input.lead === undefined ? undefined : crownAtOf(sprite.rows, walk, top)
  const figureLight = { night: frame.light.night * 0.5, dusk: frame.light.dusk }
  const glow = (x: number, y: number, color: number): number => {
    if (!resting) {
      return color
    }
    const d = Math.hypot(x - (fireLeft + FIRE_WIDTH / 2), (y - (ground - 2)) * 1.3)
    return d < 12 ? mix(color, FIRE_GLOW, (1 - d / 12) * 0.3) : color
  }
  const at = (x: number, y: number): number => {
    const crowned = crown === undefined ? undefined : crownPixel(x, y, crown.left, crown.top)
    if (crowned !== undefined) {
      return crowned
    }
    const prop = actionPixel(shown, x - walk - HD_SPRITE_WIDTH + 1, CLAWD_TOP + (y - top - 1), tick)
    if (prop !== undefined) {
      return prop
    }
    const hero = hdSpritePixel(sprite, x, y, walk, top)
    if (hero !== undefined) {
      return glow(x, y, landAtNight(hero, figureLight))
    }
    for (const one of members) {
      const ring = STATE_RING[one.member.state]
      const member = hdSpritePixel(one.sprite, x, y, one.left, one.top, ring)
      if (member !== undefined) {
        return glow(x, y, landAtNight(member, figureLight))
      }
    }
    const fire = resting ? hdCampfirePixel(x - fireLeft, ground - 1 - y, tick) : undefined
    if (fire !== undefined) {
      return fire
    }
    const pond = hdPondPixel(frame, x, y)
    if (pond !== undefined) {
      return glow(x, y, pond)
    }
    if (y >= ground) {
      const underHero = y === ground && lift === 0 && x > walk && x < walk + HD_SPRITE_WIDTH - 1
      const underMember =
        y === ground && members.some((one) => x > one.left && x < one.left + HD_SPRITE_WIDTH - 1)
      const shade = underHero ? SHADOW : underMember ? MEMBER_SHADOW : 0
      const soil = mix(hdGroundPixel(frame, x, y), 0x000000, shade)
      return glow(x, y, landAtNight(soil, frame.light))
    }
    const land = hdPlantPixel(frame, x, y) ?? hdMidPixel(frame, x, y) ?? hdFarPixel(frame, x, y)
    return glow(x, y, land === undefined ? hdSkyPixel(frame, x, y) : landAtNight(land, frame.light))
  }
  if (buffer.length !== columns * pixels) {
    buffer = new Uint32Array(columns * pixels)
  }
  for (let y = 0; y < pixels; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      buffer[y * columns + x] = at(x, y)
    }
  }
  const night = Math.max(frame.light.night, look.isNight ? 1 : 0)
  particlesInto(
    buffer,
    columns,
    pixels,
    ground,
    tick,
    particleKindOf(scene.id, night, resting),
    fireLeft
  )
  bloomInto(buffer, columns, pixels)
  vignetteInto(buffer, columns, pixels)
  const flashKind = event?.kind ?? (reaction?.kind === 'level' ? 'level' : undefined)
  if (flashKind !== undefined) {
    const age = event?.age ?? reaction?.age ?? 0
    flashInto(buffer, FLASH_COLOR[flashKind] ?? 0xffffff, flashOf(flashKind, age))
  }
  const grid: number[][] = []
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < columns; x += 1) {
      const upper = buffer[row * 2 * columns + x] ?? 0
      grid.push([UPPER_HALF, upper, buffer[(row * 2 + 1) * columns + x] ?? upper])
    }
  }
  const isRed = event?.kind === 'fail'
  const mood = thoughtMoodOf({
    caption: input.caption,
    isResting: resting,
    isReacting: reaction !== undefined,
    isWaiting: input.isWaiting === true,
    isRed,
    isMerging: shown === 'merge'
  })
  const art = gameStrings().art
  const said =
    reaction !== undefined
      ? reactionSaysOf(reaction.kind)
      : mood === 'idle'
        ? snoreOf(tick)
        : isRed && input.caption === ''
          ? art.ciIsRed
          : input.caption
  const since =
    reaction !== undefined ? tick - reaction.age : isRed ? tick - event.age : input.since
  const box = drawThought(grid, said, mood, since, {
    columns,
    rows,
    tick,
    left: walk + HD_SPRITE_WIDTH - 2,
    limit: columns,
    row: rows >= 8 ? 2 : 1,
    headRight: walk + HD_SPRITE_WIDTH - 1,
    headTop: top,
    floor: ground - 1
  })
  waitingMarksInto(grid, columns, members, HD_SPRITE_WIDTH, tick, box)
  sparklesInto(grid, columns, box?.row ?? 1, walk, HD_SPRITE_WIDTH, reaction, box)
  if (event !== undefined) {
    const centre = walk + Math.floor(HD_SPRITE_WIDTH / 2)
    floatInto(grid, columns, event, Math.max(0, Math.floor(top / 2)), centre, box)
  }
  if (input.lead !== undefined) {
    labelInto(grid, columns, rows - 1, walk + HD_SPRITE_WIDTH / 2, input.lead, LEAD_GOLD)
  }
  if (shown === 'merge' && scene.finale !== undefined) {
    paintFinale(grid, columns, rasterGlyphsOf(localizedNameOf(scene.finale)).join(''), rows)
  }
  return shakeGrid(grid, columns, quakeOf(event))
}
