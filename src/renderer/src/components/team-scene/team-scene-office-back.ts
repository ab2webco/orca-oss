import type {
  TeamSceneHold,
  TeamScenePlay,
  TeamScenePose
} from '../../../../shared/team-scene/team-scene-types'
import { drawOfficeSleep, officeHoldAlpha, officeHoldHeadDrop } from './team-scene-office-hold'
import { drawOfficePlay, officePlayArm, officePlayLean } from './team-scene-office-play'

/** Where the desk art's own chair ends, so the station is drawn without it. */
export type OfficeBackSeat = { chairEnd: number }

/** Orca's Office desk (office/desk.png): its side chair stops short of x 144. */
export const OFFICE_BACK_SEAT: OfficeBackSeat = { chairEnd: 144 }

/** Desks in one row of five, members typing at them; a walk to a tray read as a bug at a desk. */
// Why first at 0.16: the advisor gestures left of the first desk, past that sitter's own mark.
export const OFFICE_BACK_LAYOUT = {
  rowSize: 5,
  workSeated: true,
  firstX: 0.16,
  // Why: an Office lead holds nothing and its asker shows the back of its head; its mark hangs left.
  attendReachPx: 14,
  attendMarkDxPx: -20
} as const

export type OfficeBackLook = { hair: string; skin: string; shirt: string }

export const OFFICE_BACK_FALLBACK: OfficeBackLook = {
  hair: '#2a1d18',
  skin: '#e6b48c',
  shirt: '#8594a7'
}

// Points of a 128 px idle frame of Orca's Office sheets: top of the hair, cheek, chest.
const READ_AT = { hair: [62, 41], skin: [70, 56], shirt: [62, 82] } as const
const OUTLINE = '#1b1418'
const CHAIR = '#1f232c'
const CHAIR_EDGE = '#343a46'

// Frame units above the floor, in the desk art's scale; the head stops low on the screen.
const HEAD = { u: 54, r: 14 }
/** Top of the head above the floor, in frame units. */
export const OFFICE_BACK_HEAD_TOP = HEAD.u + HEAD.r
// Why beside the monitor: over the head it would cover the screen and the board above it.
const EMOTE = { dx: -48, u: 80 }

/** The centre of a sitter's emote, for a member whose chair is at `x, floor`. */
export const officeBackEmoteAt = (
  { jump }: { jump: number },
  x: number,
  floor: number,
  px: number
): { x: number; y: number } => ({ x: x + EMOTE.dx * px, y: floor - jump - EMOTE.u * px })
const SHOULDER = { x: 13, u: 38 }

const hex = (data: ArrayLike<number>, i: number): string =>
  `#${[0, 1, 2].map((k) => data[i + k]!.toString(16).padStart(2, '0')).join('')}`

/** The look of a member's sheet, from the RGBA of its first frame (`width` px a row). */
export function officeBackLookOf(
  data: ArrayLike<number> | undefined,
  width: number
): OfficeBackLook {
  const look = { ...OFFICE_BACK_FALLBACK }
  if (!data) {
    return look
  }
  const unit = width / 128
  for (const part of ['hair', 'skin', 'shirt'] as const) {
    const [x, y] = READ_AT[part]
    const i = (Math.round(y * unit) * width + Math.round(x * unit)) * 4
    if ((data[i + 3] ?? 0) >= 128) {
      look[part] = hex(data, i)
    }
  }
  return look
}

/** Reads a sheet's look once; with no 2D canvas to read from, the fallback look. */
export function readOfficeBackLook(
  sheet: CanvasImageSource,
  frame: { width: number; height: number }
): OfficeBackLook {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = frame.width
    canvas.height = frame.height
    const g = canvas.getContext('2d', { willReadFrequently: true })
    g?.drawImage(sheet, 0, 0, frame.width, frame.height, 0, 0, frame.width, frame.height)
    return officeBackLookOf(g?.getImageData(0, 0, frame.width, frame.height)?.data, frame.width)
  } catch {
    return { ...OFFICE_BACK_FALLBACK }
  }
}

/** Each sheet's look, read on first use and kept with the painter. */
export function createOfficeBackLooks() {
  const looks = new Map<CanvasImageSource, OfficeBackLook>()
  return (sheet: CanvasImageSource, frame: { width: number; height: number }): OfficeBackLook => {
    const look = looks.get(sheet) ?? readOfficeBackLook(sheet, frame)
    looks.set(sheet, look)
    return look
  }
}

/** Where on the desk art a seat falls: under the monitor when seen from behind, else its feet. */
export function deskSeatXOf(
  prop: { width: number },
  props: { stationFeet?: { x: number }; stationScreen?: { x: number; width: number } } | undefined,
  back: OfficeBackSeat | null
): number {
  const screen = props?.stationScreen
  // Why: seen from behind, the sitter faces the monitor, so the monitor is what sits on the seat.
  return back && screen ? screen.x + screen.width / 2 : (props?.stationFeet?.x ?? prop.width / 2)
}

type Point = [number, number]
// Elbow then hand of the right arm, in frame units from the floor below the head; left mirrors.
function armOf(pose: TeamScenePose, t: number, side: -1 | 1): [Point, Point] {
  if (pose === 'raise' && side === 1) {
    // Why that high: a hand that clears the monitor's top edge is what reads as asking at 320.
    const wave = Math.sin(t * 5) * 3
    return [
      [21, 72],
      [20 + wave, 106]
    ]
  }
  if (pose === 'cheer') {
    const sway = Math.sin(t * 9 + side) * 2
    return [
      [20, 58],
      [22 + sway, 78]
    ]
  }
  if (pose === 'done') {
    return [
      [23, 56],
      [9, 58]
    ]
  }
  if (pose === 'work' || pose === 'raise') {
    const bob = Math.sin(t * 14 + side * 1.7)
    return [
      [19, 27 + bob],
      [12, 22 + bob]
    ]
  }
  return [
    [17, 24],
    [15, 16]
  ]
}

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.beginPath()
  g.arc(x, y, r, 0, 2 * Math.PI)
  g.fillStyle = color
  g.fill()
  g.strokeStyle = OUTLINE
  g.stroke()
}

/** The chair seen from behind: its back, then its stem and base on the floor. */
function drawOfficeChair(
  g: CanvasRenderingContext2D,
  ground: (dx: number, u: number) => Point,
  px: number
): void {
  const [cx, cy] = ground(-16, 30)
  g.beginPath()
  g.roundRect(cx, cy, 32 * px, 22 * px, 5 * px)
  g.fillStyle = CHAIR
  g.fill()
  g.strokeStyle = CHAIR_EDGE
  g.stroke()
  g.fillStyle = CHAIR
  g.fillRect(...ground(-2, 8), 4 * px, 8 * px)
  g.fillRect(...ground(-14, 2), 28 * px, 3 * px)
}

export const OFFICE_COAT = '#5b4636'

/** Another session's desk: its chair, with a coat over the back, and nobody of ours in it. */
export function drawOfficeTakenChair(
  g: CanvasRenderingContext2D,
  x: number,
  floor: number,
  px: number
): void {
  const ground = (dx: number, u: number): Point => [x + dx * px, floor - u * px]
  g.save()
  g.lineWidth = 1.6 * px
  drawOfficeChair(g, ground, px)
  const [cx, cy] = ground(-13, 30)
  g.beginPath()
  g.roundRect(cx, cy, 26 * px, 15 * px, 4 * px)
  g.fillStyle = OFFICE_COAT
  g.fill()
  g.strokeStyle = OUTLINE
  g.stroke()
  // The collar, folded over the chair's top edge.
  g.fillRect(...ground(-6, 32), 12 * px, 3 * px)
  g.restore()
}

/** A member at its desk seen from behind, facing the monitor; `x, floor` is under its chair. */
export function drawOfficeBack(
  g: CanvasRenderingContext2D,
  x: number,
  floor: number,
  px: number,
  look: OfficeBackLook,
  {
    pose,
    jump,
    play,
    away,
    hold
  }: {
    pose: TeamScenePose
    jump: number
    play?: TeamScenePlay
    away?: true
    hold?: TeamSceneHold
  },
  t: number
): void {
  const ground = (dx: number, u: number): Point => [x + dx * px, floor - u * px]
  // Why only the chair: the session is gone, or its launch still waits for a slot.
  if (away || hold === 'queued') {
    g.save()
    g.lineWidth = 1.6 * px
    drawOfficeChair(g, ground, px)
    g.restore()
    return
  }
  const lean = officePlayLean(play, t)
  const at = (dx: number, u: number): Point => [x + (dx + lean) * px, floor - jump - u * px]
  const drop = officeHoldHeadDrop(hold)
  g.save()
  g.globalAlpha = officeHoldAlpha(hold)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = 1.6 * px
  const arms = ([-1, 1] as const).map((side) => ({
    side,
    arm: (play && officePlayArm(play, t, side)) ?? armOf(pose, t, side)
  }))
  // Why a hand over the top goes over the head: from behind, a raised hand is what shows.
  const up = (hand: Point) => hand[1] > OFFICE_BACK_HEAD_TOP
  const drawArm = (side: -1 | 1, [elbow, hand]: [Point, Point]): void => {
    const path = [
      at(side * SHOULDER.x, SHOULDER.u),
      at(side * elbow[0], elbow[1]),
      at(side * hand[0], hand[1])
    ]
    for (const [color, width] of [
      [OUTLINE, 7.6],
      [look.shirt, 6]
    ] as const) {
      g.strokeStyle = color
      g.lineWidth = width * px
      g.beginPath()
      path.forEach(([px0, py0], i) => (i === 0 ? g.moveTo(px0, py0) : g.lineTo(px0, py0)))
      g.stroke()
    }
    g.lineWidth = 1.6 * px
    if (up(hand)) {
      disc(g, ...at(side * hand[0], hand[1] + 2), 3 * px, look.skin)
    }
  }
  for (const { side, arm } of arms) {
    if (!up(arm[1])) {
      drawArm(side, arm)
    }
  }
  const [nx, ny] = at(-4, 45)
  g.fillStyle = look.skin
  g.fillRect(nx, ny, 8 * px, 5 * px)
  const [tx, ty] = at(-14, 44)
  g.beginPath()
  g.roundRect(tx, ty, 28 * px, 22 * px, 7 * px)
  g.fillStyle = look.shirt
  g.fill()
  g.strokeStyle = OUTLINE
  g.stroke()
  for (const side of [-1, 1] as const) {
    disc(g, ...at(side * (HEAD.r - 0.5), HEAD.u - 1 - drop), 2.5 * px, look.skin)
  }
  disc(g, ...at(0, HEAD.u - drop), HEAD.r * px, look.hair)
  drawOfficeChair(g, ground, px)
  for (const { side, arm } of arms) {
    if (up(arm[1])) {
      drawArm(side, arm)
    }
  }
  if (play) {
    drawOfficePlay(g, play, at, px, t)
  }
  if (hold === 'asleep') {
    drawOfficeSleep(g, at, px, t)
  }
  g.restore()
}
