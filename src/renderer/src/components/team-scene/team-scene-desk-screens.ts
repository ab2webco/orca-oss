import type { TeamSceneDesk } from '../../../../shared/team-scene/team-scene-desk'

type Rect = { x: number; y: number; width: number; height: number }

// Scene art on a dark monitor, V28's screen palette: blue lines, green done, amber waiting.
const INK = '#7fb4ff'
const TEXT = '#a8b4c8'
const DONE = '#4ade80'
const WAIT = '#ffd24a'
const DIM = '#2b3650'
const CARD = '#1c2a3a'
const TRACK = '#3b4a66'

/** Draws in the screen's own 28 x 18 units. */
const unitsOf = ({ x, y, width, height }: Rect) => {
  const [ux, uy] = [width / 28, height / 18]
  return (
    g: CanvasRenderingContext2D,
    color: string,
    u: number,
    v: number,
    w: number,
    h: number
  ) => {
    g.fillStyle = color
    g.fillRect(x + u * ux, y + v * uy, w * ux, h * uy)
  }
}

// Why eased: a bar that slows into each round reads as work going on, not a looping animation.
const eased = (p: number): number => p * p * (3 - 2 * p)

function drawPlan(g: CanvasRenderingContext2D, rect: Rect, t: number): void {
  const box = unitsOf(rect)
  const ticked = Math.floor((t * 0.7) % 5)
  for (let i = 0; i < 4; i++) {
    box(g, i < ticked ? DONE : INK, 2.5, 2.2 + i * 3.8, 2.4, 2.4)
    box(g, TEXT, 6.5, 2.7 + i * 3.8, 10 + ((i * 7) % 9), 1.4)
  }
}

function drawTests(g: CanvasRenderingContext2D, rect: Rect, t: number): void {
  const dot = unitsOf(rect)
  const passed = Math.floor((t * 3) % 19)
  for (let i = 0; i < 18; i++) {
    dot(g, i < passed ? DONE : DIM, 3 + (i % 6) * 4, 3.5 + Math.floor(i / 6) * 4.5, 2, 2)
  }
}

function drawChecks(g: CanvasRenderingContext2D, rect: Rect, t: number): void {
  const bar = unitsOf(rect)
  // Why high and thick: the sitter's head covers the lower middle, and a thin bar vanished at 320.
  bar(g, TRACK, 2.5, 2, 23, 5)
  bar(g, WAIT, 2.5, 2, 23 * eased((t * 0.35) % 1), 5)
  bar(g, TEXT, 3, 9.5, 12, 1.4)
}

/** A stroke path in the screen's units; the tick and the empty box read only when big. */
function stroke(
  g: CanvasRenderingContext2D,
  r: Rect,
  color: string,
  points: [number, number][]
): void {
  const [ux, uy] = [r.width / 28, r.height / 18]
  g.strokeStyle = color
  g.lineWidth = Math.max(1.5, 2.2 * uy)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  points.forEach(([u, v], i) => {
    const [x, y] = [r.x + u * ux, r.y + v * uy]
    if (i === 0) {
      g.moveTo(x, y)
    } else {
      g.lineTo(x, y)
    }
  })
  g.stroke()
}

function drawReview(
  g: CanvasRenderingContext2D,
  rect: Rect,
  verdict: 'approved' | 'changes' | 'waiting'
): void {
  const at = unitsOf(rect)
  at(g, CARD, 2, 2, 24, 14)
  if (verdict === 'approved') {
    // As big as the queue ticket, in the upper screen the sitter's head leaves clear.
    stroke(g, rect, DONE, [
      [8, 6.5],
      [12.5, 11],
      [20.5, 3]
    ])
    return
  }
  if (verdict === 'waiting') {
    // The box the tick will go in, still empty: a review is asked for, not given.
    const [ux, uy] = [rect.width / 28, rect.height / 18]
    g.strokeStyle = TEXT
    g.lineWidth = Math.max(1.2, 1.6 * uy)
    g.strokeRect(rect.x + 9 * ux, rect.y + 3 * uy, 10 * ux, 8 * uy)
    return
  }
  // Why a marker per row: changes asked are a list to work through, in the waiting amber.
  for (let i = 0; i < 3; i++) {
    at(g, WAIT, 4, 3 + i * 3.4, 2.4, 2.4)
    at(g, TEXT, 8, 3.5 + i * 3.4, 10 + ((i * 5) % 6), 1.4)
  }
}

function drawQueue(g: CanvasRenderingContext2D, rect: Rect, position: number): void {
  const at = unitsOf(rect)
  at(g, WAIT, 6, 4, 16, 10)
  at(g, CARD, 7, 5, 14, 8)
  g.fillStyle = WAIT
  g.font = `bold ${Math.max(6, rect.height * 0.32)}px sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // Why a number only: a place in line needs no words, so it needs no translation.
  g.fillText(`#${position}`, rect.x + rect.width / 2, rect.y + rect.height / 2)
}

/** A working member's monitor for its card's desk, over the screen's background. */
export function drawDeskScreen(
  g: CanvasRenderingContext2D,
  rect: Rect,
  desk: TeamSceneDesk,
  t: number
): void {
  g.save()
  if (desk.kind === 'plan') {
    drawPlan(g, rect, t)
  } else if (desk.kind === 'tests') {
    drawTests(g, rect, t)
  } else if (desk.kind === 'checks') {
    drawChecks(g, rect, t)
  } else if (desk.kind === 'review') {
    drawReview(g, rect, desk.verdict)
  } else {
    drawQueue(g, rect, desk.position)
  }
  g.restore()
}
