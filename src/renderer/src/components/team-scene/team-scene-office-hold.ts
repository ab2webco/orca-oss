import type { TeamSceneHold } from '../../../../shared/team-scene/team-scene-types'

type Rect = { x: number; y: number; width: number; height: number }
type Point = [number, number]

const STANDBY = '#05060a'
const DIM = '#2b3650'
const GREY = '#8a93a3'
const BOOT = '#7fb4ff'
const SLEEP = '#d6dce6'

/** How far a held member's head drops onto its desk, in frame units: at its limit or asleep. */
export const officeHoldHeadDrop = (hold: TeamSceneHold | undefined): number =>
  hold === 'limited' || hold === 'asleep' ? 10 : 0

/** A held member drawn faded: one it cannot reach. */
export const officeHoldAlpha = (hold: TeamSceneHold | undefined): number =>
  hold === 'unreachable' ? 0.45 : 1

/** Two z marks rising over a sleeping head, drawn as strokes so they need no translation. */
export function drawOfficeSleep(
  g: CanvasRenderingContext2D,
  at: (dx: number, u: number) => Point,
  px: number,
  t: number
): void {
  g.save()
  // Why light: the marks rise over the dark window wall behind the row.
  g.strokeStyle = SLEEP
  g.lineWidth = 1.6 * px
  for (let i = 0; i < 2; i++) {
    const p = (t * 0.4 + i * 0.5) % 1
    const s = (5.5 + i * 2) * px
    const [x, y] = at(14 + p * 8 + i * 4, 70 + p * 26)
    g.globalAlpha = 1 - p
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + s, y)
    g.lineTo(x, y + s)
    g.lineTo(x + s, y + s)
    g.stroke()
  }
  g.restore()
}

function hourglass(g: CanvasRenderingContext2D, r: Rect, color: string): void {
  const [cx, cy, s] = [r.x + r.width / 2, r.y + r.height / 2, r.height * 0.32]
  g.fillStyle = color
  g.beginPath()
  g.moveTo(cx - s * 0.7, cy - s)
  g.lineTo(cx + s * 0.7, cy - s)
  g.lineTo(cx, cy)
  g.lineTo(cx + s * 0.7, cy + s)
  g.lineTo(cx - s * 0.7, cy + s)
  g.lineTo(cx, cy)
  g.closePath()
  g.fill()
}

function lock(g: CanvasRenderingContext2D, r: Rect, color: string): void {
  const [cx, cy, s] = [r.x + r.width / 2, r.y + r.height / 2, r.height * 0.3]
  g.strokeStyle = color
  g.lineWidth = s * 0.28
  g.beginPath()
  g.arc(cx, cy - s * 0.2, s * 0.45, Math.PI, 0)
  g.stroke()
  g.fillStyle = color
  g.fillRect(cx - s * 0.7, cy - s * 0.2, s * 1.4, s * 1.1)
}

function clock(g: CanvasRenderingContext2D, r: Rect): void {
  const [cx, cy, s] = [r.x + r.width / 2, r.y + r.height / 2, r.height * 0.3]
  g.strokeStyle = GREY
  g.lineWidth = s * 0.18
  g.beginPath()
  g.arc(cx, cy, s, 0, 2 * Math.PI)
  g.moveTo(cx, cy)
  g.lineTo(cx, cy - s * 0.65)
  g.moveTo(cx, cy)
  g.lineTo(cx + s * 0.5, cy)
  g.stroke()
}

// Why seeded by the clock: snow that changes a few times a second reads as a lost signal.
function noise(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  const cells = 7
  const [w, h] = [r.width / (cells * 2), r.height / cells]
  let seed = Math.floor(t * 6) * 977
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells * 2; col++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      g.fillStyle = seed % 3 === 0 ? GREY : DIM
      g.fillRect(r.x + col * w, r.y + row * h, w, h)
    }
  }
}

/** A held member's screen says why it cannot work, in the card's own colour for that reason. */
export function drawOfficeHoldScreen(
  g: CanvasRenderingContext2D,
  r: Rect,
  hold: TeamSceneHold,
  t: number,
  colors: { attention: string; risk: string }
): void {
  g.save()
  g.fillStyle = STANDBY
  g.fillRect(r.x, r.y, r.width, r.height)
  if (hold === 'limited') {
    hourglass(g, r, colors.risk)
  } else if (hold === 'loggedOut') {
    lock(g, r, colors.attention)
  } else if (hold === 'unreachable') {
    noise(g, r, t)
  } else if (hold === 'queued') {
    clock(g, r)
  } else if (hold === 'starting') {
    // A boot bar: the session is starting, so the screen is waking up.
    const p = (t * 0.5) % 1
    g.fillStyle = DIM
    g.fillRect(r.x + r.width * 0.2, r.y + r.height * 0.45, r.width * 0.6, r.height * 0.1)
    g.fillStyle = BOOT
    g.fillRect(r.x + r.width * 0.2, r.y + r.height * 0.45, r.width * 0.6 * p, r.height * 0.1)
  } else {
    // Asleep: a standby light, the one thing a sleeping monitor shows.
    g.fillStyle = DIM
    g.fillRect(r.x + r.width * 0.86, r.y + r.height * 0.84, r.width * 0.06, r.height * 0.06)
  }
  g.restore()
}
