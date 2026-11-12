import type { TeamScenePlay } from '../../../../shared/team-scene/team-scene-types'

type Point = [number, number]
/** Stage px of a point given in frame units across and above the floor, lifted with the body. */
export type OfficeBodyAt = (dx: number, u: number) => Point

export const OFFICE_PLAY_COLORS = {
  phones: '#26262e',
  note: '#f6d365',
  pad: '#f4f1e8',
  plane: '#fdfdfb'
} as const

const OUTLINE = '#1b1418'
const SKETCH = '#7a7f8c'
// The plane's round: folded over the head, then a throw that sails off right.
const PLANE = { fold: 3, flight: 2 }
const PAD = { dx: -30, u: 56, w: 13, h: 17 }

/** The elbow then hand of a play's arm, in frame units (side mirrors x); null keeps the pose's. */
export function officePlayArm(play: TeamScenePlay, t: number, side: -1 | 1): [Point, Point] | null {
  if (play === 'game') {
    // Why faster than typing: a game is button mashing, so it reads apart from work.
    const tap = Math.sin(t * 22 + side * 1.3) * 1.2
    return [
      [19, 27 + tap],
      [12, 22 + tap]
    ]
  }
  if (play === 'sketch') {
    if (side === -1) {
      return [
        [20, 38],
        [24, 48]
      ]
    }
    // Why negative x: the drawing hand crosses to the pad held on the other side.
    return [
      [8, 40],
      [-22 + Math.sin(t * 9) * 2, 52 + Math.cos(t * 6) * 2]
    ]
  }
  if (play === 'plane') {
    const p = t % (PLANE.fold + PLANE.flight)
    if (p < PLANE.fold) {
      const fold = Math.sin(t * 7) * 1.5
      return [
        [18, 58],
        [6 + fold, 76]
      ]
    }
    return side === 1
      ? [
          [20, 60],
          [24, 80]
        ]
      : null
  }
  return null
}

/** Sideways sway of the head and shoulders, in frame units: a nod to the music. */
export const officePlayLean = (play: TeamScenePlay | undefined, t: number): number =>
  play === 'music' ? Math.sin(t * 3.2) * 1.5 : 0

function blob(g: CanvasRenderingContext2D, [x, y]: Point, r: number, color: string): void {
  g.beginPath()
  g.arc(x, y, r, 0, 2 * Math.PI)
  g.fillStyle = color
  g.fill()
}

function drawMusic(g: CanvasRenderingContext2D, at: OfficeBodyAt, px: number, t: number): void {
  const [cx, cy] = at(0, 54)
  g.strokeStyle = OFFICE_PLAY_COLORS.phones
  g.lineWidth = 2.6 * px
  g.beginPath()
  g.arc(cx, cy, 16 * px, Math.PI * 1.08, Math.PI * 1.92)
  g.stroke()
  for (const side of [-1, 1] as const) {
    blob(g, at(side * 15, 52), 4.2 * px, OFFICE_PLAY_COLORS.phones)
  }
  for (let i = 0; i < 2; i++) {
    const p = (t * 0.6 + i * 0.5) % 1
    const side = i === 0 ? 1 : -1
    const [nx, ny] = at(side * (22 + p * 6), 58 + p * 34)
    g.globalAlpha = 1 - p
    blob(g, [nx, ny], 2.4 * px, OFFICE_PLAY_COLORS.note)
    g.fillRect(nx + 1.6 * px, ny - 7 * px, 1.1 * px, 7 * px)
    g.globalAlpha = 1
  }
}

function drawPad(g: CanvasRenderingContext2D, at: OfficeBodyAt, px: number, t: number): void {
  const [x, y] = at(PAD.dx - PAD.w / 2, PAD.u + PAD.h / 2)
  g.lineWidth = 1.2 * px
  g.beginPath()
  g.rect(x, y, PAD.w * px, PAD.h * px)
  g.fillStyle = OFFICE_PLAY_COLORS.pad
  g.fill()
  g.strokeStyle = OUTLINE
  g.stroke()
  // Why growing: the sketch fills in, then a fresh page starts.
  const strokes = Math.floor((t * 0.8) % 5)
  g.fillStyle = SKETCH
  for (let i = 0; i < strokes; i++) {
    g.fillRect(x + 2 * px, y + (3 + i * 3) * px, (5 + ((i * 5) % 6)) * px, 1 * px)
  }
}

function drawPlane(g: CanvasRenderingContext2D, at: OfficeBodyAt, px: number, t: number): void {
  const p = t % (PLANE.fold + PLANE.flight)
  const flight = Math.max(0, p - PLANE.fold) / PLANE.flight
  const [x, y] = at(flight * 110, 80 + Math.sin(flight * Math.PI) * 26 - flight * 8)
  const s = 7 * px
  g.globalAlpha = flight > 0.8 ? (1 - flight) * 5 : 1
  g.lineWidth = 1 * px
  g.beginPath()
  g.moveTo(x - s, y + s * 0.2)
  g.lineTo(x + s, y - s * 0.15)
  g.lineTo(x - s * 0.4, y + s * 0.6)
  g.closePath()
  g.fillStyle = OFFICE_PLAY_COLORS.plane
  g.fill()
  g.strokeStyle = OUTLINE
  g.stroke()
  g.globalAlpha = 1
}

/** What a play holds or sends off, drawn over the seated member. */
export function drawOfficePlay(
  g: CanvasRenderingContext2D,
  play: TeamScenePlay,
  at: OfficeBodyAt,
  px: number,
  t: number
): void {
  if (play === 'music') {
    drawMusic(g, at, px, t)
  } else if (play === 'sketch') {
    drawPad(g, at, px, t)
  } else if (play === 'plane') {
    drawPlane(g, at, px, t)
  }
}
