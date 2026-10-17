import { actionPixel, PROP_WIDTH } from './action-props'
import { castPixelOf, hdAdvisorOf, hdAdvisorPropPixel, hdPetOf, hdStageOf } from './hd-cast'
import { landInLight, MIDNIGHT, NOON, type Daylight } from './hd-daylight'
import {
  bloomInto,
  FLASH_COLOR,
  flashInto,
  flashOf,
  particleKindOf,
  particlesInto,
  vignetteInto
} from './hd-fx'
import { isTeamEventShown, quakeOf, shakeGrid, type TeamEvent } from './hd-overlay'
import {
  crownAtOf,
  crownPixel,
  FIRE_WIDTH,
  hdCampfirePixel,
  hdTrailOf,
  MAX_SHOWN,
  placedPartyOf,
  STATE_RING,
  type HdMember,
  type March
} from './hd-party'
import { costumeSpriteOf, frameSpriteOf, hdSpritePixel } from './hd-sprite'
import { hdWordsInto } from './hd-words'
import { mix, UPPER_HALF } from './pixel-canvas'
import type { Action, FlowPhase } from './quest-policy'
import { isReacting, type Reaction } from './scene'
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

// Columns the hero keeps clear ahead of it for its prop.
const WALK_SLACK = 8

export const hdWalkColumn = (width: number, tick: number): number => {
  const span = Math.max(1, width - HD_SPRITE_WIDTH - WALK_SLACK)
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

// Reused across frames of the same size; the mask marks which pixels are figures.
let buffer = new Uint32Array(0)
let figures = new Uint8Array(0)

export const hdSceneGridOf = (input: HdSceneInput): number[][] => {
  const { scene, columns, rows, tick } = input
  const reaction = isReacting(input.reaction) ? input.reaction : undefined
  const event = isTeamEventShown(input.event) ? input.event : undefined
  const resting = input.isResting === true && reaction === undefined
  const look = scene.looks[input.phase ?? 'working']
  const light = input.light ?? (look.isNight ? MIDNIGHT : NOON)
  const frame = hdFrameOf({ look, width: columns, rows, tick, scroll: resting ? 0 : tick, light })
  const { ground, pixels } = frame
  const pose = hdHeroPoseOf(tick, resting)
  const sprite = costumeSpriteOf(scene.costumes[input.phase ?? 'working'], pose.frame, resting)
  // Why a stage: Jev's advisor keeps the right edge, so the hero and its pet walk short of it.
  const stage = hdStageOf(columns, input.advisor, HD_SPRITE_WIDTH)
  const petDef = scene.cast?.pet
  // Why a trail: the pet and party walk behind the hero, so its path starts where they all fit.
  const party = input.party ?? []
  const {
    shown: following,
    pitch,
    trail
  } = hdTrailOf({
    stage,
    count: party.length,
    petWidth:
      petDef?.frames[0] === undefined ? 0 : frameSpriteOf(petDef.frames[0], petDef.colors).width,
    spriteWidth: HD_SPRITE_WIDTH,
    slack: WALK_SLACK
  })
  const walk = resting ? hdRestColumnOf(stage) : trail + hdWalkColumn(stage - trail, tick)
  const isPetted = reaction?.kind === 'pet' && petDef !== undefined
  const hop = reaction !== undefined && reaction.age % 6 < 3 ? 2 : 0
  const lift = isPetted ? 0 : hop
  const top = ground - sprite.rows.length + 1 - lift - pose.bob
  const pet =
    petDef === undefined
      ? undefined
      : hdPetOf({
          pet: petDef,
          tick,
          isResting: resting,
          isPetted,
          heroLeft: walk,
          heroWidth: HD_SPRITE_WIDTH,
          ground,
          lift: isPetted ? hop : 0
        })
  const advisor =
    input.advisor === undefined ? undefined : hdAdvisorOf(input.advisor, columns, ground, tick)
  const shown =
    resting || walk + HD_SPRITE_WIDTH - 1 + PROP_WIDTH > stage ? undefined : input.action
  const fireLeft = walk + HD_SPRITE_WIDTH + 1
  const members = placedPartyOf({
    scene,
    party,
    leavers: input.leavers ?? [],
    marches: input.marches ?? new Map(),
    columns: stage,
    ground,
    tick,
    walk: pet === undefined || resting ? walk : pet.left,
    pitch,
    shown: resting ? MAX_SHOWN : following,
    isResting: resting,
    fireRight: fireLeft + FIRE_WIDTH,
    spriteWidth: HD_SPRITE_WIDTH
  })
  const crown = input.lead === undefined ? undefined : crownAtOf(sprite.rows, walk, top)
  // Why NOON for a night look: its costumes are drawn for the dark and keep their own colours.
  const figureLight = look.isNight
    ? NOON
    : { night: frame.light.night * 0.5, dusk: frame.light.dusk }
  const glow = (x: number, y: number, color: number): number => {
    if (!resting) {
      return color
    }
    const d = Math.hypot(x - (fireLeft + FIRE_WIDTH / 2), (y - (ground - 2)) * 1.3)
    return d < 12 ? mix(color, FIRE_GLOW, (1 - d / 12) * 0.3) : color
  }
  const figureAt = (x: number, y: number): number | undefined => {
    const hero = hdSpritePixel(sprite, x, y, walk, top) ?? castPixelOf(pet, x, y)
    if (hero !== undefined) {
      return hero
    }
    for (const one of members) {
      const member = hdSpritePixel(
        one.sprite,
        x,
        y,
        one.left,
        one.top,
        STATE_RING[one.member.state]
      )
      if (member !== undefined) {
        return member
      }
    }
    return castPixelOf(advisor, x, y)
  }
  const at = (x: number, y: number): number => {
    const crowned = crown === undefined ? undefined : crownPixel(x, y, crown.left, crown.top)
    const prop = actionPixel(shown, x - walk - HD_SPRITE_WIDTH + 1, CLAWD_TOP + (y - top - 1), tick)
    if (crowned !== undefined || prop !== undefined) {
      return crowned ?? prop ?? 0
    }
    const figure = figureAt(x, y)
    if (figure !== undefined) {
      figures[y * columns + x] = 1
      return glow(x, y, landInLight(figure, figureLight))
    }
    const held =
      input.advisor === undefined || advisor === undefined
        ? undefined
        : hdAdvisorPropPixel(input.advisor, advisor, x, y, ground)
    const fire = resting ? hdCampfirePixel(x - fireLeft, ground - 1 - y, tick) : undefined
    const pond = hdPondPixel(frame, x, y)
    if (held !== undefined || fire !== undefined || pond !== undefined) {
      return held ?? fire ?? glow(x, y, pond ?? 0)
    }
    if (y >= ground) {
      const isUnder = (left: number, width: number) =>
        y === ground && x > left && x < left + width - 1
      const underHero = lift === 0 && isUnder(walk, HD_SPRITE_WIDTH)
      const underOther =
        members.some((one) => isUnder(one.left, HD_SPRITE_WIDTH)) ||
        (pet !== undefined && isUnder(pet.left, pet.sprite.width)) ||
        (advisor !== undefined && isUnder(advisor.left, advisor.sprite.width))
      const shade = underHero ? SHADOW : underOther ? MEMBER_SHADOW : 0
      const soil = mix(hdGroundPixel(frame, x, y), 0x000000, shade)
      return glow(x, y, landInLight(soil, frame.light, frame.dayLift, look.isNight))
    }
    const plant = hdPlantPixel(frame, x, y)
    if (plant !== undefined) {
      return glow(x, y, landInLight(plant, frame.light, frame.dayLift, look.isNight))
    }
    return glow(x, y, hdMidPixel(frame, x, y) ?? hdFarPixel(frame, x, y) ?? hdSkyPixel(frame, x, y))
  }
  if (buffer.length !== columns * pixels) {
    buffer = new Uint32Array(columns * pixels)
    figures = new Uint8Array(columns * pixels)
  }
  figures.fill(0)
  for (let y = 0; y < pixels; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      buffer[y * columns + x] = at(x, y)
    }
  }
  const particles = particleKindOf(scene.id, frame.light.night, resting)
  particlesInto(buffer, columns, pixels, ground, tick, particles, fireLeft)
  // Why spared: the vignette and bloom would darken or tint the figures out of their own colours.
  bloomInto(buffer, columns, pixels, figures)
  vignetteInto(buffer, columns, pixels, figures)
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
  const hero = { left: walk, top, width: HD_SPRITE_WIDTH }
  hdWordsInto(grid, {
    scene,
    columns,
    rows,
    tick,
    ground,
    caption: input.caption,
    since: input.since,
    isResting: resting,
    isWaiting: input.isWaiting === true,
    reaction,
    event,
    action: shown,
    lead: input.lead,
    hero,
    speaker:
      isPetted && pet !== undefined
        ? { left: pet.left, top: pet.top, width: pet.sprite.width }
        : hero,
    members,
    memberWidth: HD_SPRITE_WIDTH,
    advisor: input.advisor
  })
  return shakeGrid(grid, columns, quakeOf(event))
}
